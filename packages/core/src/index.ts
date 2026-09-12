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

/**
 * Usage origin. Rows are never deduped across sources: OMP, Cursor, Claude
 * Code and the standalone `agy` CLI keep separate transcripts, so the same
 * model on two of them is two rows.
 */
export type Source = "omp" | "cursor" | "claude-code" | "antigravity";

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
  /**
   * Absolute working directory the session ran in — OMP's `cwd` off the
   * session header, which is what "project" means here. Absent for sources
   * that report no directory at all (Cursor) and for headerless transcripts.
   */
  project?: string;
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

/**
 * One project's usage for the selected period: its models, its tokens and its
 * estimate. A project is a working directory — OMP's and Claude Code's `cwd`,
 * the workspace an `agy` conversation ran in; `null` is the bucket for
 * transcripts that named none.
 *
 * Cursor never appears here — its cycle totals carry no directory.
 */
export interface ProjectUsage {
  project: string | null;
  tokens: TokenCounts;
  estimatedCents: number | null;
  /** Same row shape as `DashboardSnapshot.models`, keyed by `(source, model)`. */
  models: Array<ModelAggregate & { source: Source; estimatedCents: number | null }>;
}

/** Subtotal for one source. `null` cost means at least one price is unknown. */
export interface SourceTotals {
  estimatedCents: number | null;
  tokens: TokenCounts;
}

/**
 * Cost of one part's tokens in cents, or `null` when the model has no rate
 * covering that instant. Injected by the host — this package never opens the
 * price table, and `timestamp` is empty for Cursor cycle aggregates, which the
 * host prices at the current rate or not at all.
 */
export type PriceCents = (
  model: string,
  tokens: TokenCounts,
  timestamp: string,
) => number | null;

/**
 * Cursor's included-pool percentages, from `/api/usage-summary`
 * `individualUsage.plan`. Cursor's own numbers about Cursor's own plan — never
 * derived from our tokens, never mixed into `estimatedCents`.
 */
export interface CursorIncludedUsage {
  /** 0–100, `autoPercentUsed`: the Auto (`default`) model pool. */
  autoPercentUsed: number;
  /** 0–100, `apiPercentUsed`: the named-model pool. */
  apiPercentUsed: number;
}

/**
 * One provider-reported usage clock: a subscription window, and how much of it
 * is gone. The fraction is the provider's own answer about its own limit — it
 * is not derived from token counts and has nothing to do with estimated cost.
 */
export interface UsageLimit {
  /** OMP's limit id, e.g. `anthropic:5h`. Stable per provider window. */
  id: string;
  /** The provider's own label, e.g. `Claude 5 Hour`. */
  label: string;
  /** The provider's own window label, e.g. `5 Hour`, `Weekly`. */
  windowLabel?: string;
  /** 0–1 as the provider reported it; `null` when it reported no number. */
  usedFraction: number | null;
  /** ISO instant the window rolls over; `null` when there is no clock yet. */
  resetsAt: string | null;
}

/**
 * Every limit one account holds with one provider. Two Claude subscriptions are
 * two entries with the same `provider` — the only place this app splits by
 * account, because a limit belongs to an account and to nothing else.
 */
export interface ProviderLimits {
  /** OMP's provider id, e.g. `anthropic`, `google-antigravity`. */
  provider: string;
  /**
   * Who the subscription belongs to, as OMP recorded it — an email. Absent
   * when the provider has no per-account identity (an Ollama Cloud API key),
   * and then the UI falls back to `Account A` / `B` in array order.
   */
  account?: string;
  /**
   * ISO of the newest observation in this group. These are provider answers
   * OMP cached while it worked, not something this app fetched.
   */
  observedAt: string;
  limits: UsageLimit[];
}

/** The half-open window a set of Cursor aggregates covers, both ISO instants. */
export interface CursorWindow {
  start: string;
  end: string;
}

/**
 * What a Cursor collector can return.
 *
 * `cycle_aggregate` is the Cursor Pro path: per-model totals with no
 * timestamps. The rows cover the whole billing cycle unless `window` says
 * otherwise — `get-aggregated-usage-events` accepts `startDate` / `endDate`
 * and narrows the aggregate server-side, which is how a calendar period gets
 * real Cursor numbers instead of a cycle total standing in for a day.
 * `events` is the unimplemented Enterprise path (`crsr_` admin key), kept in
 * the union so adding it later is not a breaking change.
 */
export type CursorSnapshot =
  | {
      mode: "cycle_aggregate";
      /** ISO, from `/api/usage-summary` `billingCycleStart`. */
      cycleStart: string;
      /** ISO, from `/api/usage-summary` `billingCycleEnd`. */
      cycleEnd: string;
      /**
       * The window `models` actually covers. Absent means the whole cycle —
       * the only case where Cursor's scope can differ from the period.
       */
      window?: CursorWindow;
      models: ModelAggregate[];
      /**
       * Plan percentages from the same `/api/usage-summary` call. Absent when
       * Cursor answered without them (a team plan, an unlimited account).
       */
      included?: CursorIncludedUsage;
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
  /**
   * Every project that used tokens in `period`, biggest spender first. The
   * Projects route is this list; nothing on the Dashboard filters by it.
   */
  projects: ProjectUsage[];
  /**
   * Combined estimate for everything the period actually covers: the
   * timestamped sources (OMP, Claude Code) plus Cursor, or those two alone
   * when Cursor could only answer for its whole billing cycle (`mixedPeriod`)
   * — a 30-day cycle total has no business inside a one-day figure. `null` if
   * any included row has an unknown price.
   */
  estimatedCents: number | null;
  /**
   * Which sources the Settings toggles have switched on. A source that is off
   * contributes nothing — no events, no cost, no subtotal row on the
   * dashboard: it is not part of this screen at all, rather than a zero on it.
   * Its stored rows are untouched and return when it is switched back on.
   */
  enabled: Record<Source, boolean>;
  omp: SourceTotals;
  /**
   * Claude Code's own transcripts (`~/.claude/projects`), the CLI the VS Code
   * extension drives. Its own subtotal because it is its own tool: the tokens
   * are separate from OMP's, even when both bill the same Claude subscription.
   * Zeroed, and off the screen, while `enabled["claude-code"]` is false.
   */
  claudeCode: SourceTotals;
  /**
   * The standalone `agy` CLI's own turns, priced from the per-conversation
   * records it writes under `~/.gemini/antigravity-cli`. Its own subtotal
   * because it is its own tool: an OMP-routed Gemini turn and an `agy` turn
   * are different turns in different trees, and neither is deduped against
   * the other. Zeroed, and off the screen, while `enabled.antigravity` is
   * false.
   *
   * Not the Antigravity **quota card** in `limits`: that is Google's own
   * clock on a subscription window and is never cost. This is cost.
   */
  antigravity: SourceTotals;
  cursor: SourceTotals & {
    mode: CursorSnapshot["mode"];
    /**
     * e.g. "Cycle to date" — set only while the rows really are cycle-wide.
     * A windowed fetch narrows them to the period, and then there is no cycle
     * label to footnote.
     */
    cycleLabel?: string;
    /**
     * The Pro cycle window, passed straight through from `CursorSnapshot` so
     * the UI can name it. It never bounds the rollup: the cycle does not
     * shrink to the period. Absent in `events` mode.
     */
    cycleStart?: string;
    cycleEnd?: string;
    /**
     * The window Cursor actually answered for, when the period was narrow
     * enough to ask. Absent means the rows are the whole cycle.
     */
    window?: CursorWindow;
    /** Cursor's own included-pool percentages, for the limits panel only. */
    included?: CursorIncludedUsage;
  };
  /** By-model rows keyed by `(source, model)`; same model twice is expected. */
  models: Array<ModelAggregate & { source: Source; estimatedCents: number | null }>;
  /**
   * Cursor could only answer for its billing cycle while the period is
   * narrower, so its cost is shown on its own row and is **not** in
   * `estimatedCents`. False once a windowed fetch matches the period, and on
   * all-time, where the cycle does not clash.
   */
  mixedPeriod: boolean;
  /**
   * Provider usage clocks, one entry per (provider, account). Never filtered by
   * `period` and never priced: a subscription window is not a calendar month.
   * Empty when OMP has reported none.
   */
  limits: ProviderLimits[];
  fetch: {
    /** ISO timestamp, serializable counterpart of `FetchState.lastSuccessAt`. */
    lastSuccessAt: string | null;
    status: FetchState["status"];
    error?: string;
  };
}
