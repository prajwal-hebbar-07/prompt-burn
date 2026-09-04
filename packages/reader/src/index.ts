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
import { loadUsageEvents } from "@prompt-burn/db";
import {
  collectAllSources,
  defaultCursorStatePath,
  defaultSessionsDirectory,
  readCursorAuth,
} from "@prompt-burn/collectors";

export type { DashboardSnapshot, PeriodFilter };

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
 * Local conditions, not failures: there is simply no Cursor session to read, so
 * the Cursor section degrades to empty and the pass still counts as clean.
 * `expired` and `unreadable` do count as failures — they are actionable.
 */
const CURSOR_DEGRADED: ReadonlySet<string> = new Set(["not_installed", "signed_out"]);

export interface UsageReader {
  discover(): Promise<ReaderHealth[]>;
  fetch(): Promise<FetchResult>;
  getSnapshot(period: PeriodFilter): Promise<DashboardSnapshot>;
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

  return {
    async discover() {
      const ompPath = ompDirectory ?? defaultSessionsDirectory();
      const statePath = cursorStatePath ?? defaultCursorStatePath();
      const auth = readCursorAuth(statePath);
      return [
        {
          source: "omp",
          available: existsSync(ompPath),
          detail: ompPath,
        },
        {
          source: "cursor",
          available: auth.ok,
          // Never the token: only where it came from, or why there is none.
          detail: auth.ok ? statePath : auth.detail,
        },
      ];
    },

    async fetch() {
      const at = now().toISOString();
      const result = await collectAllSources({ db, ompDirectory, cursorStatePath, fetchImpl });
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
      const ompEvents = loadUsageEvents(db, "omp");
      return buildDashboardSnapshot({
        period,
        ompEvents,
        cursor: cursorCycle ?? EMPTY_CURSOR_CYCLE,
        now: now(),
      });
    },
  };
}
