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
 * Costs are derived, never stored: the host injects `priceCents`, which resolves
 * one part's rate out of `price_entries` and returns cents, or `null` when the
 * model is unpriced. That is what makes a price added in Settings apply to old
 * events — nothing here caches a cost. Without a pricer every `estimatedCents`
 * is `null`, and one unknown part makes every total containing it `null` too:
 * the UI renders that as `—`, never `$0`. Cursor's own `totalCents` is
 * informational and never feeds our estimate.
 */

import type {
  CursorSnapshot,
  DashboardSnapshot,
  PeriodFilter,
  PriceCents,
  ProviderLimits,
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
  /**
   * Provider usage clocks, straight from the host. Passed through untouched:
   * they carry no timestamps this package could filter and no tokens it could
   * price.
   */
  limits?: readonly ProviderLimits[];
  /** Injectable clock for `today` / `this_month`. */
  now?: Date;
  /** Owned by the shell that fetched; aggregation never invents an error. */
  fetch?: DashboardSnapshot["fetch"];
  /**
   * Host-supplied cost lookup. Omitted — a mock snapshot, a shell with no
   * database open — leaves every `estimatedCents` null.
   */
  priceCents?: PriceCents;
}

/** Adds `part` into `total`. Cursor omits cache keys when zero. */
function addTokens(total: Required<TokenCounts>, part: TokenCounts): void {
  total.input += part.input;
  total.output += part.output;
  total.cacheRead += part.cacheRead ?? 0;
  total.cacheWrite += part.cacheWrite ?? 0;
}

/** One rollup input: tokens plus the instant its rate is resolved at. */
interface PricedPart {
  model: string;
  tokens: TokenCounts;
  /** Empty for Cursor cycle aggregates — the pricer decides what to do with that. */
  timestamp: string;
}

/** `null` poisons: one unknown rate makes every total containing it unknown. */
function addCents(total: number | null, part: number | null): number | null {
  return total === null || part === null ? null : total + part;
}

/**
 * Sums per-model rollups for one source. Rows keep first-seen order and are
 * never merged across sources: `(source, model)` is the key, so the same model
 * on OMP and Cursor is deliberately two rows.
 *
 * Costs are summed per part, not per rollup: an event keeps the rate that was
 * valid at its own timestamp, so two events on the same model can price at two
 * different rates.
 */
function rollup(source: Source, parts: readonly PricedPart[], priceCents?: PriceCents) {
  const total: Required<TokenCounts> = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const byModel = new Map<string, { tokens: Required<TokenCounts>; cents: number | null }>();
  // No pricer is no cost knowledge, not free usage: nothing can be counted.
  const start = priceCents ? 0 : null;
  let totalCents = start;

  for (const part of parts) {
    let row = byModel.get(part.model);
    if (!row) {
      row = { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, cents: start };
      byModel.set(part.model, row);
    }
    addTokens(row.tokens, part.tokens);
    addTokens(total, part.tokens);
    const cents = priceCents ? priceCents(part.model, part.tokens, part.timestamp) : null;
    row.cents = addCents(row.cents, cents);
    totalCents = addCents(totalCents, cents);
  }

  return {
    totals: { estimatedCents: totalCents, tokens: total },
    // Unknown ids and Cursor's `default` (Auto) stay as rows: an unpriceable
    // model must stay visible, not disappear from the table.
    rows: [...byModel].map(([model, row]) => ({
      source,
      model,
      tokens: row.tokens,
      estimatedCents: row.cents,
    })),
  };
}

/**
 * Builds the aggregated view model: per-source subtotals, `(source, model)`
 * rows and the mixed-period flag. Combined tokens are the plain sum of the two
 * subtotals — sources are never deduped.
 */
export function buildDashboardSnapshot(input: SnapshotInput): DashboardSnapshot {
  const { period, ompEvents, cursor, now, priceCents } = input;

  const omp = rollup(
    "omp",
    filterEventsByPeriod(ompEvents, period, now).map(({ model, tokens, timestamp }) => ({
      model,
      tokens,
      timestamp,
    })),
    priceCents,
  );

  // Enterprise events are timestamped, so they take the same period as OMP.
  // Pro cycle aggregates have no timestamps and are used exactly as fetched.
  const cursorParts: PricedPart[] =
    cursor.mode === "events"
      ? filterEventsByPeriod(cursor.events, period, now).map(({ model, tokens, timestamp }) => ({
          model,
          tokens,
          timestamp,
        }))
      : cursor.models.map(({ model, tokens }) => ({ model, tokens, timestamp: "" }));
  const cursorRollup = rollup("cursor", cursorParts, priceCents);

  return {
    period,
    estimatedCents: addCents(omp.totals.estimatedCents, cursorRollup.totals.estimatedCents),
    omp: omp.totals,
    cursor: {
      ...cursorRollup.totals,
      mode: cursor.mode,
      // The window is carried for labelling only; it never bounds the rollup.
      ...(cursor.mode === "cycle_aggregate"
        ? {
            cycleLabel: CURSOR_CYCLE_LABEL,
            cycleStart: cursor.cycleStart,
            cycleEnd: cursor.cycleEnd,
            // Cursor's own plan percentages. Present only when Cursor sent
            // them, so the limits panel can omit the rows rather than show 0%.
            ...(cursor.included ? { included: cursor.included } : {}),
          }
        : {}),
    },
    models: [...omp.rows, ...cursorRollup.rows],
    // All-time is the one period a cycle-to-date Cursor total does not clash
    // with; the cycle is still footnoted through `cycleLabel`.
    mixedPeriod: cursor.mode === "cycle_aggregate" && period.kind !== "all_time",
    // Provider clocks are not calendar data: they never move with `period`.
    limits: [...(input.limits ?? [])],
    fetch: input.fetch ?? { lastSuccessAt: null, status: "idle" },
  };
}
