/**
 * Prompt Burn domain types, plus the package's public re-exports.
 *
 * `DashboardSnapshot` is the contract the UI renders against; period filtering
 * (commit 5), model normalization (commit 6) and aggregation (commit 7) all
 * exist to produce one.
 */

export { filterEventsByPeriod, periodBounds } from "./period.js";
export { canonicalModelId } from "./model.js";
export { buildDashboardSnapshot, CURSOR_CYCLE_LABEL, type SnapshotInput } from "./aggregate.js";

/** Usage origin. OMP and Cursor only; rows are never deduped across sources. */
export type Source = "omp" | "cursor";

/**
 * Token counts for one event or aggregate. Cache keys are optional because the
 * Cursor API omits them when zero; OMP always reports them (0 when unused).
 */
export interface TokenCounts {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/** One priced-by-tokens usage record. OMP: one JSONL assistant line. */
export interface UsageEvent {
  /** Stable per-source id, e.g. `omp:${sessionId}:${line.id}`. */
  id: string;
  source: Source;
  /** ISO 8601 timestamp, UTC. */
  timestamp: string;
  /** Canonical model id after the alias map. */
  model: string;
  /** Model id exactly as the source reported it. */
  rawModel: string;
  tokens: TokenCounts;
  sessionId?: string;
}

/**
 * Calendar period selected in the UI. Device timezone; `range` end is the
 * inclusive end day (code converts to exclusive next-day 00:00).
 */
export type PeriodFilter =
  | { kind: "today" }
  | { kind: "this_month" }
  | { kind: "all_time" }
  | { kind: "range"; start: string; end: string };

/** Per-model token rollup. Cost is derived later, never stored here. */
export interface ModelAggregate {
  model: string;
  tokens: TokenCounts;
}

/** Subtotal for one source. `null` cost means at least one price is unknown. */
export interface SourceTotals {
  estimatedCents: number | null;
  tokens: TokenCounts;
}

/**
 * What a Cursor collector can return.
 *
 * `cycle_aggregate` is the Cursor Pro path: cycle-to-date per-model totals with
 * no timestamps, stored with `period = 'cycle'` and no synthesized timestamps.
 * `events` is the unimplemented Enterprise path (`crsr_` admin key), kept in the
 * union so adding it later is not a breaking change.
 */
export type CursorSnapshot =
  | {
      mode: "cycle_aggregate";
      /** ISO, from `/api/usage-summary` `billingCycleStart`. */
      cycleStart: string;
      /** ISO, from `/api/usage-summary` `billingCycleEnd`. */
      cycleEnd: string;
      models: ModelAggregate[];
    }
  | {
      mode: "events";
      events: UsageEvent[];
    };

/** Fetch lifecycle as the UI needs it: spinner on `fetching`, keep old data. */
export interface FetchState {
  status: "idle" | "fetching" | "error";
  lastSuccessAt: Date | null;
  error?: string;
}

/** The full view model the dashboard renders. Frozen contract for the UI. */
export interface DashboardSnapshot {
  period: PeriodFilter;
  /** Combined estimate; `null` if any included row has an unknown price. */
  estimatedCents: number | null;
  omp: SourceTotals;
  cursor: SourceTotals & {
    mode: CursorSnapshot["mode"];
    /** e.g. "Cycle to date". */
    cycleLabel?: string;
  };
  /** By-model rows keyed by `(source, model)`; same model twice is expected. */
  models: Array<ModelAggregate & { source: Source; estimatedCents: number | null }>;
  /** Cursor is cycle-only while the period is not all-time-equivalent. */
  mixedPeriod: boolean;
  fetch: {
    /** ISO timestamp, serializable counterpart of `FetchState.lastSuccessAt`. */
    lastSuccessAt: string | null;
    status: FetchState["status"];
    error?: string;
  };
}
