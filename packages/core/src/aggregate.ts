/**
 * Rolls transcript events (OMP, Claude Code) and a Cursor snapshot into the
 * `DashboardSnapshot` fields the UI renders.
 *
 * Two scopes meet here. Transcript events are timestamped and obey the calendar
 * period; Cursor aggregates are timestamp-free, so they are used exactly as
 * the collector fetched them — narrowed to the period when it asked Cursor for
 * that window, cycle-wide when it could not. Cycle-wide rows against a
 * narrower period are flagged `mixedPeriod` and kept out of `estimatedCents`:
 * a 30-day cycle total added to one day of local spend is not a day's cost.
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
  /**
   * Claude Code transcript events (`~/.claude/projects`), same shape and same
   * calendar filtering as OMP's. Omitted — or empty, when Settings has the
   * source switched off — leaves its subtotal at zero.
   */
  claudeEvents?: readonly UsageEvent[];
  cursor: CursorSnapshot;
  /**
   * The Settings toggles, as the host read them. Anything unnamed defaults to
   * on. A source switched off is expected to arrive empty too — this only
   * tells the UI to leave it off the screen instead of showing a zero row.
   */
  enabled?: Partial<Record<Source, boolean>>;
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

/** One rollup input: its origin, tokens, and the instant its rate resolves at. */
interface PricedPart {
  source: Source;
  model: string;
  tokens: TokenCounts;
  /** Empty for Cursor cycle aggregates — the pricer decides what to do with that. */
  timestamp: string;
}

/** A part that came from a transcript, so it may name the directory it ran in. */
interface EventPart extends PricedPart {
  project?: string;
}

/**
 * Timestamped events of one source as rollup parts. The working directory
 * rides along so the project breakdown can group on it; `rollup` ignores it.
 */
function partsOf(source: Source, events: readonly UsageEvent[]): EventPart[] {
  return events.map(({ model, tokens, timestamp, project }) => ({
    source,
    model,
    tokens,
    timestamp,
    ...(project === undefined ? {} : { project }),
  }));
}

/** `null` poisons: one unknown rate makes every total containing it unknown. */
function addCents(total: number | null, part: number | null): number | null {
  return total === null || part === null ? null : total + part;
}

/**
 * Sums per-model rollups. Rows keep first-seen order and are never merged
 * across sources: `(source, model)` is the key, so the same model on OMP and
 * Claude Code is deliberately two rows.
 *
 * Costs are summed per part, not per rollup: an event keeps the rate that was
 * valid at its own timestamp, so two events on the same model can price at two
 * different rates.
 */
function rollup(parts: readonly PricedPart[], priceCents?: PriceCents) {
  const total: Required<TokenCounts> = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const byModel = new Map<
    string,
    { source: Source; model: string; tokens: Required<TokenCounts>; cents: number | null }
  >();
  // No pricer is no cost knowledge, not free usage: nothing can be counted.
  const start = priceCents ? 0 : null;
  let totalCents = start;

  for (const part of parts) {
    // NUL cannot occur in a source slug or a model id, so it cannot make two
    // different pairs collide on one key.
    const key = `${part.source}\u0000${part.model}`;
    let row = byModel.get(key);
    if (!row) {
      row = {
        source: part.source,
        model: part.model,
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        cents: start,
      };
      byModel.set(key, row);
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
    rows: [...byModel.values()].map(({ source, model, tokens, cents }) => ({
      source,
      model,
      tokens,
      estimatedCents: cents,
    })),
  };
}

/**
 * Per-project rollups, biggest spender first, over every event source that
 * records a working directory — OMP and Claude Code. Cursor is absent by
 * construction: a cycle-to-date aggregate belongs to no directory and
 * splitting it would be invention.
 *
 * Events whose transcript had no header (so no `cwd`) group under `null`
 * rather than vanishing: unattributed usage is still usage.
 */
function rollupProjects(
  parts: readonly EventPart[],
  priceCents?: PriceCents,
): DashboardSnapshot["projects"] {
  const groups = new Map<string, PricedPart[]>();
  for (const { project, ...part } of parts) {
    // The empty string cannot collide with a real absolute path.
    const existing = groups.get(project ?? "");
    if (existing) existing.push(part);
    else groups.set(project ?? "", [part]);
  }

  return [...groups]
    .map(([key, grouped]) => {
      const { totals, rows } = rollup(grouped, priceCents);
      return {
        project: key === "" ? null : key,
        tokens: totals.tokens,
        estimatedCents: totals.estimatedCents,
        models: rows,
      };
    })
    .sort((a, b) => {
      // Spend first; a project holding an unpriced model sinks below every
      // priced one, and token volume breaks the tie — same rule as the table.
      const spend = (b.estimatedCents ?? -1) - (a.estimatedCents ?? -1);
      if (spend !== 0) return spend;
      const left = a.tokens;
      const right = b.tokens;
      return (
        right.input +
        right.output +
        right.cacheRead +
        right.cacheWrite -
        (left.input + left.output + left.cacheRead + left.cacheWrite)
      );
    });
}

/**
 * Builds the aggregated view model: per-source subtotals, `(source, model)`
 * rows, the per-project breakdown the Projects route renders, and the
 * mixed-period flag. Combined tokens are the plain sum of the subtotals —
 * sources are never deduped.
 */
export function buildDashboardSnapshot(input: SnapshotInput): DashboardSnapshot {
  const { period, ompEvents, claudeEvents = [], cursor, now, priceCents } = input;

  const ompParts = partsOf("omp", filterEventsByPeriod(ompEvents, period, now));
  const omp = rollup(ompParts, priceCents);

  // Claude Code's transcripts are timestamped like OMP's, so they take the
  // same calendar period and land in the combined total unconditionally.
  const claudeParts = partsOf("claude-code", filterEventsByPeriod(claudeEvents, period, now));
  const claudeCode = rollup(claudeParts, priceCents);

  // Enterprise events are timestamped, so they take the same period as OMP.
  // Pro cycle aggregates have no timestamps and are used exactly as fetched.
  const cursorParts: PricedPart[] =
    cursor.mode === "events"
      ? partsOf("cursor", filterEventsByPeriod(cursor.events, period, now))
      : cursor.models.map(({ model, tokens }) => ({
          source: "cursor" as const,
          model,
          tokens,
          timestamp: "",
        }));
  const cursorRollup = rollup(cursorParts, priceCents);

  // Cursor's rows are cycle-wide unless the collector narrowed them to a
  // window. While they are cycle-wide and the period is not all-time, the two
  // scopes genuinely differ — and a cycle total is then excluded from the
  // combined figure rather than added to a day's OMP spend.
  const cursorWindow = cursor.mode === "cycle_aggregate" ? cursor.window : undefined;
  const cycleWide = cursor.mode === "cycle_aggregate" && cursorWindow === undefined;
  const mixedPeriod = cycleWide && period.kind !== "all_time";

  return {
    period,
    // Same calendar scope as everything else on the screen: the projects are
    // rolled from the period-filtered events, never from the whole history.
    projects: rollupProjects([...ompParts, ...claudeParts], priceCents),
    // Only what the period covers. Cursor out of scope means the timestamped
    // sources alone here; its own subtotal still carries the cycle number.
    estimatedCents: mixedPeriod
      ? addCents(omp.totals.estimatedCents, claudeCode.totals.estimatedCents)
      : addCents(
          addCents(omp.totals.estimatedCents, claudeCode.totals.estimatedCents),
          cursorRollup.totals.estimatedCents,
        ),
    // Unnamed is on: a caller that knows nothing about toggles — a mock
    // snapshot, a test — gets every source on screen, as before.
    enabled: { omp: true, "claude-code": true, cursor: true, ...input.enabled },
    omp: omp.totals,
    claudeCode: claudeCode.totals,
    cursor: {
      ...cursorRollup.totals,
      mode: cursor.mode,
      // The cycle window is carried for labelling either way; the cycle
      // *label* claims the rows are cycle-wide, so it goes when they are not.
      ...(cursor.mode === "cycle_aggregate"
        ? {
            ...(cycleWide ? { cycleLabel: CURSOR_CYCLE_LABEL } : {}),
            cycleStart: cursor.cycleStart,
            cycleEnd: cursor.cycleEnd,
            ...(cursorWindow ? { window: cursorWindow } : {}),
            // Cursor's own plan percentages. Present only when Cursor sent
            // them, so the limits panel can omit the rows rather than show 0%.
            ...(cursor.included ? { included: cursor.included } : {}),
          }
        : {}),
    },
    models: [...omp.rows, ...claudeCode.rows, ...cursorRollup.rows],
    mixedPeriod,
    // Provider clocks are not calendar data: they never move with `period`.
    limits: [...(input.limits ?? [])],
    fetch: input.fetch ?? { lastSuccessAt: null, status: "idle" },
  };
}
