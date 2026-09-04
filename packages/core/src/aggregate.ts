/**
 * Rolls OMP events and a Cursor snapshot into the `DashboardSnapshot` fields
 * the UI renders.
 *
 * Two scopes meet here. OMP events are timestamped and obey the calendar
 * period; Cursor Pro returns cycle-to-date aggregates with no timestamps, so
 * they are passed through untouched — never filtered, never split into days.
 * When those scopes differ the snapshot says so via `mixedPeriod`, and the hero
 * copy names both.
 *
 * Costs are not computed here. There is no price DB until commit 9, so every
 * `estimatedCents` is `null` — the UI renders that as `—`, never `$0`. Cursor's
 * own `totalCents` is informational and never feeds our estimate.
 */

import type {
  CursorSnapshot,
  DashboardSnapshot,
  ModelAggregate,
  PeriodFilter,
  Source,
  TokenCounts,
  UsageEvent,
} from "./index.js";
import { filterEventsByPeriod } from "./period.js";

/** Cursor Pro is always cycle-to-date; the UI footnotes it with this. */
export const CURSOR_CYCLE_LABEL = "Cycle to date";

export interface SnapshotInput {
  period: PeriodFilter;
  /** OMP usage events; `model` is already canonical. Filtered by `period`. */
  ompEvents: readonly UsageEvent[];
  cursor: CursorSnapshot;
  /** Injectable clock for `today` / `this_month`. */
  now?: Date;
  /** Owned by the shell that fetched; aggregation never invents an error. */
  fetch?: DashboardSnapshot["fetch"];
}

/** Adds `part` into `total`. Cursor omits cache keys when zero. */
function addTokens(total: Required<TokenCounts>, part: TokenCounts): void {
  total.input += part.input;
  total.output += part.output;
  total.cacheRead += part.cacheRead ?? 0;
  total.cacheWrite += part.cacheWrite ?? 0;
}

/**
 * Sums per-model rollups for one source. Rows keep first-seen order and are
 * never merged across sources: `(source, model)` is the key, so the same model
 * on OMP and Cursor is deliberately two rows.
 */
function rollup(source: Source, parts: readonly ModelAggregate[]) {
  const total: Required<TokenCounts> = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const byModel = new Map<string, Required<TokenCounts>>();

  for (const part of parts) {
    let row = byModel.get(part.model);
    if (!row) {
      row = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      byModel.set(part.model, row);
    }
    addTokens(row, part.tokens);
    addTokens(total, part.tokens);
  }

  return {
    totals: { estimatedCents: null, tokens: total },
    // Unknown ids and Cursor's `default` (Auto) stay as rows: an unpriceable
    // model must stay visible, not disappear from the table.
    rows: [...byModel].map(([model, tokens]) => ({
      source,
      model,
      tokens,
      estimatedCents: null,
    })),
  };
}

/**
 * Builds the aggregated view model: per-source subtotals, `(source, model)`
 * rows and the mixed-period flag. Combined tokens are the plain sum of the two
 * subtotals — sources are never deduped.
 */
export function buildDashboardSnapshot(input: SnapshotInput): DashboardSnapshot {
  const { period, ompEvents, cursor, now } = input;

  const omp = rollup(
    "omp",
    filterEventsByPeriod(ompEvents, period, now).map(({ model, tokens }) => ({ model, tokens })),
  );

  // Enterprise events are timestamped, so they take the same period as OMP.
  // Pro cycle aggregates have no timestamps and are used exactly as fetched.
  const cursorParts =
    cursor.mode === "events"
      ? filterEventsByPeriod(cursor.events, period, now).map(({ model, tokens }) => ({
          model,
          tokens,
        }))
      : cursor.models;
  const cursorRollup = rollup("cursor", cursorParts);

  return {
    period,
    estimatedCents: null,
    omp: omp.totals,
    cursor: {
      ...cursorRollup.totals,
      mode: cursor.mode,
      ...(cursor.mode === "cycle_aggregate" ? { cycleLabel: CURSOR_CYCLE_LABEL } : {}),
    },
    models: [...omp.rows, ...cursorRollup.rows],
    // All-time is the one period a cycle-to-date Cursor total does not clash
    // with; the cycle is still footnoted through `cycleLabel`.
    mixedPeriod: cursor.mode === "cycle_aggregate" && period.kind !== "all_time",
    fetch: input.fetch ?? { lastSuccessAt: null, status: "idle" },
  };
}
