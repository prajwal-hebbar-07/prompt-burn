/**
 * `UsageReader` — the interface both shells implement. The desktop sidecar
 * and the VS Code extension host both call this one implementation, so there is
 * a single set of `@prompt-burn/db` + `@prompt-burn/collectors` calls behind both
 * dashboards.
 *
 * Every source lands here: `fetch()` runs the parallel collector pass, and
 * `getSnapshot()` aggregates the stored transcript rows — OMP's and Claude
 * Code's — together with Cursor's numbers for that same period, asking Cursor
 * for the period's own window when the period is bounded and falling back to
 * the cached cycle when it cannot answer. Partial success is normal — a failed
 * source keeps its previous data while the others' new data is applied.
 *
 * A source switched off in Settings is neither collected nor shown: its stored
 * rows stay in the database, out of the snapshot, until it is switched back on.
 *
 * Host-side only. The UI package never imports this, or anything under it.
 */

import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import {
  buildDashboardSnapshot,
  periodBounds,
  type CursorSnapshot,
  type DashboardSnapshot,
  type PeriodFilter,
  type ProviderLimits,
} from "@prompt-burn/core";
import {
  estimateCents,
  insertPriceEntry,
  loadUsageEvents,
  readSettings,
  resolvePrice,
  writeSettings,
  type AppSettings,
  type NewPriceEntry,
} from "@prompt-burn/db";
import {
  collectAllSources,
  defaultClaudeDirectory,
  defaultCursorStatePath,
  defaultSessionsDirectory,
  fetchCursorWindowAggregate,
  ompAgentDatabase,
  readCursorAuth,
  readOmpLimits,
  type CursorWindowAggregate,
} from "@prompt-burn/collectors";

export type { AppSettings, DashboardSnapshot, NewPriceEntry, PeriodFilter };

/** One source's availability, as `discover()` reports it to the UI. */
export interface ReaderHealth {
  source: "omp" | "cursor" | "claude-code";
  /** Is this source collectable on this machine right now? */
  available: boolean;
  /** Human-readable detail: a directory path, or why it is unavailable. */
  detail?: string;
}

/** What one `fetch()` pass did. Never throws — errors are data here. */
export interface FetchResult {
  at: string;
  /** Every source that could run did. Partial success is `false` with data applied. */
  ok: boolean;
  /** Combined per-source failure text, e.g. "Cursor failed: …". */
  error?: string;
  /** Per-source sync counters, straight from the collectors. */
  omp: { ok: boolean; error?: string; scannedFiles: number; skippedFiles: number; insertedEvents: number };
  claudeCode: {
    ok: boolean;
    error?: string;
    scannedFiles: number;
    skippedFiles: number;
    insertedEvents: number;
  };
  cursor: { ok: boolean; reason?: string; error?: string; models: number };
  /**
   * Ollama Cloud's clocks. Never flips `ok`: they are a panel, not usage, and
   * the endpoint behind them is undocumented.
   */
  ollama: { ok: boolean; reason?: string; error?: string };
}

/** Before the first Cursor fetch: an empty cycle, never a faked timestamp. */
const EMPTY_CURSOR_CYCLE: CursorSnapshot = {
  mode: "cycle_aggregate",
  cycleStart: "",
  cycleEnd: "",
  models: [],
};

/**
 * Local conditions, not failures: there is simply no Cursor session to read, or
 * the user turned the source off, so the Cursor section degrades to empty and
 * the pass still counts as clean. `expired` and `unreadable` do count as
 * failures — they are actionable.
 */
const CURSOR_DEGRADED: ReadonlySet<string> = new Set([
  "not_installed",
  "signed_out",
  "disabled",
]);

/** What `discover()` reports for a source the user switched off in Settings. */
const DISABLED_DETAIL = "Disabled in Settings";

export interface UsageReader {
  discover(): Promise<ReaderHealth[]>;
  fetch(): Promise<FetchResult>;
  getSnapshot(period: PeriodFilter): Promise<DashboardSnapshot>;
  /** Persisted source toggles, with `ompPath` resolved to the real directory. */
  getSettings(): Promise<AppSettings>;
  /** Persists only the keys given; the next fetch and snapshot use them. */
  saveSettings(patch: Partial<AppSettings>): Promise<void>;
  /** Prices a previously unknown model. Retroactive by construction. */
  addPrice(entry: NewPriceEntry): Promise<void>;
}

/**
 * The shared reader over an open database. `syncOmpSessions` is itself
 * transactional and `loadUsageEvents` runs a single prepared statement, so a
 * failure mid-fetch never leaves a half-written sync behind.
 */
export function createUsageReader(
  db: DatabaseSync,
  options: {
    ompDirectory?: string;
    claudeDirectory?: string;
    cursorStatePath?: string;
    fetchImpl?: typeof fetch;
    /** `agy`'s raw keychain secret; injectable so tests stay off the keychain. */
    antigravitySecret?: () => string;
    now?: () => Date;
  } = {},
): UsageReader {
  const {
    ompDirectory,
    claudeDirectory,
    cursorStatePath,
    fetchImpl,
    antigravitySecret,
    now = () => new Date(),
  } = options;

  // The last cycle Cursor returned, kept so a period change or a later failed
  // fetch still renders it. ponytail: in memory only — a restart shows an empty
  // Cursor section until the fetch-on-open lands, which is the honest state
  // anyway. Persist to `usage_events` (period = 'cycle') if that stops being
  // true.
  let cursorCycle: CursorSnapshot | undefined;
  // Ollama's clocks, same deal: fetched over the network, so unlike the OMP
  // clocks in `usage_history` they cannot be re-read per snapshot.
  let ollamaLimits: ProviderLimits | undefined;
  // Antigravity's clocks, likewise over the network — and the reason they are
  // fetched at all: with the provider unlinked from OMP, `usage_history` stops
  // gaining rows while `agy` keeps burning the same pool.
  let antigravityLimits: ProviderLimits | undefined;
  // Per-period aggregates Cursor has already answered for, keyed by the
  // period's own bounds. A window is worth one round trip, not one per render;
  // `fetch()` clears the map so "today" keeps growing as the day does.
  const cursorWindows = new Map<string, CursorWindowAggregate>();

  /**
   * The effective source configuration, re-read on every call: the other shell
   * shares this file and may have changed a toggle or the path since this
   * process started.
   */
  function sources(): AppSettings {
    const stored = readSettings(db);
    // A stored override wins, then the constructor injection (tests only),
    // then the collector's own default location.
    return {
      ...stored,
      ompPath: stored.ompPath || ompDirectory || defaultSessionsDirectory(),
      claudePath: stored.claudePath || claudeDirectory || defaultClaudeDirectory(),
    };
  }

  /**
   * Cursor's numbers for `period`: its own window when the period is bounded
   * and Cursor can answer, the cached cycle otherwise.
   *
   * The fallback is deliberate rather than an error — a cycle total is still
   * worth showing on its own row, and `buildDashboardSnapshot` keeps it out of
   * the combined estimate while it is the wrong scope. All-time never asks:
   * Cursor rejects a window spanning its two backend boundaries.
   */
  async function cursorForPeriod(period: PeriodFilter): Promise<CursorSnapshot> {
    const cycle = cursorCycle ?? EMPTY_CURSOR_CYCLE;
    // Nothing fetched yet, or the Enterprise event path: nothing to narrow.
    if (cycle.mode !== "cycle_aggregate" || cycle.cycleStart === "") return cycle;
    if (!sources().cursorEnabled) return cycle;

    const { start, end } = periodBounds(period, now());
    if (start === null || end === null) return cycle;
    // A period runs to the next local midnight; Cursor is asked only as far as
    // the present, and a period that has not started yet is not asked at all.
    const until = Math.min(end, now().getTime());
    if (until <= start) return cycle;

    const key = `${start}|${end}`;
    let windowed = cursorWindows.get(key);
    if (!windowed) {
      const auth = readCursorAuth(cursorStatePath ?? defaultCursorStatePath());
      if (!auth.ok) return cycle;
      try {
        windowed = await fetchCursorWindowAggregate(auth, { start, end: until }, fetchImpl);
      } catch {
        // Transport, HTTP or shape failure. The cycle still renders; the
        // snapshot marks it out of scope rather than inventing a day's number.
        return cycle;
      }
      cursorWindows.set(key, windowed);
    }
    // Cycle dates and plan percentages do not move with the period, so they
    // come from the cycle fetch; only the rows and their scope change.
    return { ...cycle, window: windowed.window, models: windowed.models };
  }

  return {
    async discover() {
      const { ompEnabled, ompPath, cursorEnabled, claudeEnabled, claudePath } = sources();
      const statePath = cursorStatePath ?? defaultCursorStatePath();
      // A disabled source is not probed at all: Cursor's database is not even
      // opened to look for a token.
      const auth = cursorEnabled ? readCursorAuth(statePath) : undefined;
      return [
        {
          source: "omp",
          available: ompEnabled && existsSync(ompPath),
          detail: ompEnabled ? ompPath : DISABLED_DETAIL,
        },
        {
          source: "claude-code",
          available: claudeEnabled && existsSync(claudePath),
          detail: claudeEnabled ? claudePath : DISABLED_DETAIL,
        },
        {
          source: "cursor",
          available: auth?.ok === true,
          // Never the token: only where it came from, or why there is none.
          detail: auth === undefined ? DISABLED_DETAIL : auth.ok ? statePath : auth.detail,
        },
      ];
    },

    async fetch() {
      const at = now().toISOString();
      const { ompEnabled, ompPath, cursorEnabled, claudeEnabled, claudePath } = sources();
      const result = await collectAllSources({
        db,
        ompDirectory: ompPath,
        claudeDirectory: claudePath,
        cursorStatePath,
        fetchImpl,
        ...(antigravitySecret ? { antigravitySecret } : {}),
        ompEnabled,
        cursorEnabled,
        claudeEnabled,
      });
      const cycle = result.cursor.cycle;
      if (cycle) cursorCycle = cycle;
      if (result.ollama.limits) ollamaLimits = result.ollama.limits;
      if (result.antigravity.limits) antigravityLimits = result.antigravity.limits;
      // Every window Cursor answered for is now stale — "today" has grown, and
      // a manual refresh is the user asking for current numbers.
      cursorWindows.clear();

      const cursorFailed = !result.cursor.ok && !CURSOR_DEGRADED.has(result.cursor.reason ?? "");
      const errors: string[] = [];
      if (!result.omp.ok) errors.push(`OMP failed: ${result.omp.error ?? "unknown error"}`);
      if (!result.claudeCode.ok) {
        errors.push(`Claude Code failed: ${result.claudeCode.error ?? "unknown error"}`);
      }
      if (cursorFailed) errors.push(`Cursor failed: ${result.cursor.error ?? "unknown error"}`);

      return {
        at,
        ok: result.omp.ok && result.claudeCode.ok && !cursorFailed,
        ...(errors.length > 0 ? { error: errors.join(" · ") } : {}),
        omp: {
          ok: result.omp.ok,
          ...(result.omp.error === undefined ? {} : { error: result.omp.error }),
          ...result.omp.sync,
        },
        claudeCode: {
          ok: result.claudeCode.ok,
          ...(result.claudeCode.error === undefined ? {} : { error: result.claudeCode.error }),
          ...result.claudeCode.sync,
        },
        cursor: {
          ok: result.cursor.ok,
          ...(result.cursor.reason === undefined ? {} : { reason: result.cursor.reason }),
          ...(result.cursor.error === undefined ? {} : { error: result.cursor.error }),
          models: cycle?.mode === "cycle_aggregate" ? cycle.models.length : 0,
        },
        ollama: {
          ok: result.ollama.ok,
          ...(result.ollama.reason === undefined ? {} : { reason: result.ollama.reason }),
          ...(result.ollama.error === undefined ? {} : { error: result.ollama.error }),
        },
        antigravity: {
          ok: result.antigravity.ok,
          ...(result.antigravity.reason === undefined ? {} : { reason: result.antigravity.reason }),
          ...(result.antigravity.error === undefined ? {} : { error: result.antigravity.error }),
        },
      };
    },

    async getSnapshot(period: PeriodFilter) {
      const at = now().toISOString();
      const { ompEnabled, ompPath, cursorEnabled, claudeEnabled } = sources();
      return buildDashboardSnapshot({
        period,
        // Switched off means off the screen, not just unsynced: no events, no
        // subtotal row. Stored rows stay in the database and come back the
        // moment the toggle does.
        ompEvents: ompEnabled ? loadUsageEvents(db, "omp") : [],
        claudeEvents: claudeEnabled ? loadUsageEvents(db, "claude-code") : [],
        cursor: cursorEnabled ? await cursorForPeriod(period) : EMPTY_CURSOR_CYCLE,
        enabled: { omp: ompEnabled, "claude-code": claudeEnabled, cursor: cursorEnabled },
        now: now(),
        // Provider clocks. The OMP ones are re-read out of OMP's own agent
        // database on every snapshot — OMP refreshes them while it works, and
        // they are not ours to cache — while Ollama's came over the network in
        // the last `fetch()`. A disabled OMP source reports none of either,
        // exactly like its events.
        // A fetched Antigravity card always wins over OMP's cached rows for the
        // same provider: once the provider is unlinked those rows only age, and
        // two cards for one subscription is worse than a stale one.
        limits: [
          ...(ompEnabled
            ? [
                ...readOmpLimits(ompAgentDatabase(ompPath), now()).filter(
                  (group) => antigravityLimits === undefined || group.provider !== "google-antigravity",
                ),
                ...(ollamaLimits ? [ollamaLimits] : []),
              ]
            : []),
          ...(antigravityLimits ? [antigravityLimits] : []),
        ],
        // Cost is a join, never a stored column, so every snapshot re-reads
        // `price_entries`: a rate added in Settings prices old events on the
        // very next call, with no rewrite of `usage_events`. Cursor aggregates
        // have no timestamp of their own and price at the rate in force now —
        // the only honest window for a total that carries no per-request time.
        // ponytail: one prepared lookup per row. Cache by (model, window) if a
        // snapshot over tens of thousands of events ever feels slow.
        priceCents: (model, tokens, timestamp) =>
          estimateCents(resolvePrice(db, model, timestamp === "" ? at : timestamp), tokens),
      });
    },

    async getSettings() {
      return sources();
    },

    async saveSettings(patch: Partial<AppSettings>) {
      writeSettings(db, patch);
    },

    async addPrice(entry: NewPriceEntry) {
      insertPriceEntry(db, entry);
    },
  };
}
