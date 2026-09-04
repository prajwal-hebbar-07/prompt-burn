/**
 * `UsageReader` — the interface both shells implement, frozen in
 * `docs/implementation-plan.md`. The desktop sidecar and the VS Code extension
 * host both call this one implementation, so there is a single set of
 * `@prompt-burn/db` + `@prompt-burn/collectors` calls behind both dashboards.
 *
 * Both sources land here: `fetch()` runs the parallel collector pass, and
 * `getSnapshot()` aggregates stored OMP rows together with the last Cursor
 * cycle. Partial success is normal — a failed source keeps its previous data
 * while the other's new data is applied.
 *
 * Host-side only. The UI package never imports this, or anything under it.
 */

import { existsSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import {
  buildDashboardSnapshot,
  type CursorSnapshot,
  type DashboardSnapshot,
  type PeriodFilter,
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
  defaultCursorStatePath,
  defaultSessionsDirectory,
  readCursorAuth,
} from "@prompt-burn/collectors";

export type { AppSettings, DashboardSnapshot, NewPriceEntry, PeriodFilter };

/** One source's availability, as `discover()` reports it to the UI. */
export interface ReaderHealth {
  source: "omp" | "cursor";
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
  cursor: { ok: boolean; reason?: string; error?: string; models: number };
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
    cursorStatePath?: string;
    fetchImpl?: typeof fetch;
    now?: () => Date;
  } = {},
): UsageReader {
  const { ompDirectory, cursorStatePath, fetchImpl, now = () => new Date() } = options;

  // The last cycle Cursor returned, kept so a period change or a later failed
  // fetch still renders it. ponytail: in memory only — a restart shows an empty
  // Cursor section until the fetch-on-open lands, which is the honest state
  // anyway. Persist to `usage_events` (period = 'cycle') if that stops being
  // true.
  let cursorCycle: CursorSnapshot | undefined;

  /**
   * The effective source configuration, re-read on every call: the other shell
   * shares this file and may have changed a toggle or the path since this
   * process started.
   */
  function sources(): AppSettings {
    const stored = readSettings(db);
    // A stored override wins, then the constructor injection (tests only),
    // then the collector's own default location.
    return { ...stored, ompPath: stored.ompPath || ompDirectory || defaultSessionsDirectory() };
  }

  return {
    async discover() {
      const { ompEnabled, ompPath, cursorEnabled } = sources();
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
          source: "cursor",
          available: auth?.ok === true,
          // Never the token: only where it came from, or why there is none.
          detail: auth === undefined ? DISABLED_DETAIL : auth.ok ? statePath : auth.detail,
        },
      ];
    },

    async fetch() {
      const at = now().toISOString();
      const { ompEnabled, ompPath, cursorEnabled } = sources();
      const result = await collectAllSources({
        db,
        ompDirectory: ompPath,
        cursorStatePath,
        fetchImpl,
        ompEnabled,
        cursorEnabled,
      });
      const cycle = result.cursor.cycle;
      if (cycle) cursorCycle = cycle;

      const cursorFailed = !result.cursor.ok && !CURSOR_DEGRADED.has(result.cursor.reason ?? "");
      const errors: string[] = [];
      if (!result.omp.ok) errors.push(`OMP failed: ${result.omp.error ?? "unknown error"}`);
      if (cursorFailed) errors.push(`Cursor failed: ${result.cursor.error ?? "unknown error"}`);

      return {
        at,
        ok: result.omp.ok && !cursorFailed,
        ...(errors.length > 0 ? { error: errors.join(" · ") } : {}),
        omp: {
          ok: result.omp.ok,
          ...(result.omp.error === undefined ? {} : { error: result.omp.error }),
          ...result.omp.sync,
        },
        cursor: {
          ok: result.cursor.ok,
          ...(result.cursor.reason === undefined ? {} : { reason: result.cursor.reason }),
          ...(result.cursor.error === undefined ? {} : { error: result.cursor.error }),
          models: cycle?.mode === "cycle_aggregate" ? cycle.models.length : 0,
        },
      };
    },

    async getSnapshot(period: PeriodFilter) {
      const at = now().toISOString();
      return buildDashboardSnapshot({
        period,
        ompEvents: loadUsageEvents(db, "omp"),
        cursor: cursorCycle ?? EMPTY_CURSOR_CYCLE,
        now: now(),
        // Cost is a join, never a stored column, so every snapshot re-reads
        // `price_entries`: a rate added in Settings prices old events on the
        // very next call, with no rewrite of `usage_events`. Cycle aggregates
        // have no timestamp of their own and price at the rate in force now —
        // the only honest window for a cycle-to-date total.
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
