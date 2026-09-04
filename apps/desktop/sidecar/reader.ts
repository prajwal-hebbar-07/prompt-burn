/**
 * `UsageReader` — the interface both shells implement, frozen in
 * `docs/implementation-plan.md`. The desktop sidecar is this file; the VS Code
 * extension host later implements the same three methods over the same
 * `@prompt-burn/db` + `@prompt-burn/collectors` calls.
 *
 * This slice is OMP only: `fetch()` runs the existing incremental sync, and
 * `getSnapshot(all_time)` aggregates through core. Cursor contributes an empty
 * cycle — the honest representation of "no Cursor data yet" — and its
 * collector, when it exists, replaces that one value.
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
import { defaultSessionsDirectory, syncOmpSessions } from "@prompt-burn/collectors";

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
  ok: boolean;
  error?: string;
  /** Per-source sync counters, straight from the collectors. */
  omp: { scannedFiles: number; skippedFiles: number; insertedEvents: number };
}

/** No Cursor collector exists yet: an empty cycle, never a faked timestamp. */
const EMPTY_CURSOR_CYCLE: CursorSnapshot = {
  mode: "cycle_aggregate",
  cycleStart: "",
  cycleEnd: "",
  models: [],
};

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
  options: { ompDirectory?: string; now?: () => Date } = {},
): UsageReader {
  const { ompDirectory, now = () => new Date() } = options;

  return {
    async discover() {
      const ompPath = ompDirectory ?? defaultSessionsDirectory();
      return [
        {
          source: "omp",
          available: existsSync(ompPath),
          detail: ompPath,
        },
        {
          source: "cursor",
          available: false,
          detail: "No Cursor collector yet — lands with the Cursor phase.",
        },
      ];
    },

    async fetch() {
      const at = now().toISOString();
      try {
        const omp = syncOmpSessions(db, ompDirectory);
        return { at, ok: true, omp };
      } catch (error) {
        // The sync rolls back on error and the stored data is untouched; the
        // error is carried back, never thrown, so the window can keep old data.
        return {
          at,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          omp: { scannedFiles: 0, skippedFiles: 0, insertedEvents: 0 },
        };
      }
    },

    async getSnapshot(period: PeriodFilter) {
      const ompEvents = loadUsageEvents(db, "omp");
      return buildDashboardSnapshot({
        period,
        ompEvents,
        cursor: EMPTY_CURSOR_CYCLE,
        now: now(),
      });
    },
  };
}