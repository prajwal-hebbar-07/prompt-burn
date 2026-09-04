/**
 * The Dashboard route body: the hero score panel, then the by-model board.
 *
 * Combined estimate, then both source subtotals — always both, never deduped,
 * never re-derived here. Cursor Pro is cycle-to-date whatever the period is, so
 * when `mixedPeriod` is set the subtitle names both scopes; the cycle's own
 * dates are the cycle banner's job, not this card's.
 *
 * One unpriced model used to blank the whole number: `estimatedCents` is null
 * when any included row has no rate, and the hero showed `—` even with dollars
 * of priced usage on screen. It now falls back to the sum of the rows that *do*
 * price, marked `≈` and counted ("2 models unpriced"), so an unknown rate costs
 * you precision, not the number.
 *
 * This package never touches a filesystem, a network, the collectors, the
 * database or the sidecar: hosts pass a `DashboardSnapshot` in and rendering is
 * all that happens here.
 */

import { CURSOR_CYCLE_LABEL, type DashboardSnapshot, type Source } from "@prompt-burn/core";
import { CycleCard, CycleFootnote } from "./CursorCycle.js";
import { UNKNOWN_COST, formatCents, tokenLine } from "./format.js";
import { ModelTable } from "./ModelTable.js";
import { periodLabel } from "./PeriodBar.js";

/** Product's exact sentence for a successful fetch with nothing in it. */
const NO_USAGE = "No OMP or Cursor usage for this period";

/** Before the first successful fetch there is nothing to be zero about. */
const NOT_FETCHED = "No usage data yet";

/** What the priced rows add up to, and how many rows had no rate at all. */
export interface PricedSubtotal {
  /** Sum of the rows with a known rate; `null` when not one row priced. */
  cents: number | null;
  unpriced: number;
}

/** Adds up the rows that price, optionally for one source only. */
export function pricedSubtotal(
  rows: DashboardSnapshot["models"],
  source?: Source,
): PricedSubtotal {
  let cents: number | null = null;
  let unpriced = 0;
  for (const row of rows) {
    if (source !== undefined && row.source !== source) continue;
    if (row.estimatedCents === null) unpriced += 1;
    else cents = (cents ?? 0) + row.estimatedCents;
  }
  return { cents, unpriced };
}

/**
 * A cost for display: the exact total, else the priced rows marked `≈`, else
 * the em dash. `$0` is never a stand-in for an unknown rate.
 */
function costText(exact: number | null, fallback: PricedSubtotal): string {
  if (exact !== null) return formatCents(exact);
  if (fallback.cents !== null) return `≈${formatCents(fallback.cents)}`;
  return UNKNOWN_COST;
}

/** The combined total: exact, approximate from priced rows, or the em dash. */
export function formatEstimatedTotal(snapshot: DashboardSnapshot): string {
  return costText(snapshot.estimatedCents, pricedSubtotal(snapshot.models));
}

/**
 * The body copy for an empty period, or `null` when there is data to show.
 *
 * Never fetched and fetched-but-empty are different states: only a successful
 * fetch can say the period really had no usage. A fetch in flight keeps
 * whatever the previous snapshot had — this only decides the empty body.
 */
export function emptyStateMessage(snapshot: DashboardSnapshot): string | null {
  const tokens = [snapshot.omp.tokens, snapshot.cursor.tokens];
  const used =
    snapshot.models.length > 0 ||
    tokens.some((t) => t.input + t.output + (t.cacheRead ?? 0) + (t.cacheWrite ?? 0) > 0);
  if (used) return null;
  return snapshot.fetch.lastSuccessAt === null ? NOT_FETCHED : NO_USAGE;
}

/**
 * `Estimated total · OMP: Today · Cursor: cycle to date` while the scopes
 * differ, otherwise `Estimated total · This month`. Locked in product.md and
 * spec.md — every mixed period names both scopes, not just Today.
 */
export function heroSubtitle(snapshot: DashboardSnapshot): string {
  const period = periodLabel(snapshot.period);
  if (!snapshot.mixedPeriod) return `Estimated total · ${period}`;
  const cycle = (snapshot.cursor.cycleLabel ?? CURSOR_CYCLE_LABEL).toLowerCase();
  return `Estimated total · OMP: ${period} · Cursor: ${cycle}`;
}

/** Total tokens for a source, used only to split the meter when nothing prices. */
function tokenWeight(tokens: DashboardSnapshot["omp"]["tokens"]): number {
  return tokens.input + tokens.output + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0);
}

/**
 * How wide each half of the split meter is. Spend decides it; with no priced
 * row anywhere the meter falls back to token volume so the bar still says which
 * source did the work.
 */
export function sourceShares(
  snapshot: DashboardSnapshot,
  omp: number | null,
  cursor: number | null,
): { omp: number; cursor: number } {
  const split = (a: number, b: number) => {
    const total = a + b;
    if (total <= 0) return { omp: 0, cursor: 0 };
    return { omp: (a / total) * 100, cursor: (b / total) * 100 };
  };
  const spend = split(Math.max(omp ?? 0, 0), Math.max(cursor ?? 0, 0));
  if (spend.omp + spend.cursor > 0) return spend;
  return split(tokenWeight(snapshot.omp.tokens), tokenWeight(snapshot.cursor.tokens));
}

interface SubtotalRowProps {
  testId: string;
  label: string;
  /** Token class for the source dot; the label always travels with it. */
  dotClass: string;
  text: string;
}

/** One source line: colored dot, text label, amount. Never hidden. */
function SubtotalRow({ testId, label, dotClass, text }: SubtotalRowProps) {
  return (
    <div
      data-testid={testId}
      className="flex items-center justify-between rounded-control px-2 py-1.5 transition-colors hover:bg-surface-subtle"
    >
      <span className="flex items-center gap-2 text-body">
        <span aria-hidden="true" className={`size-2.5 rounded-full ${dotClass}`} />
        {label}
      </span>
      <span className="font-mono text-body font-medium tabular-nums">{text}</span>
    </div>
  );
}

export interface DashboardProps {
  snapshot: DashboardSnapshot;
}

export function Dashboard({ snapshot }: DashboardProps) {
  const cursorLabel = snapshot.cursor.cycleLabel
    ? `Cursor (${snapshot.cursor.cycleLabel.toLowerCase()})`
    : "Cursor";
  const empty = emptyStateMessage(snapshot);

  const combined = pricedSubtotal(snapshot.models);
  const ompPriced = pricedSubtotal(snapshot.models, "omp");
  const cursorPriced = pricedSubtotal(snapshot.models, "cursor");
  const shares = sourceShares(
    snapshot,
    snapshot.omp.estimatedCents ?? ompPriced.cents,
    snapshot.cursor.estimatedCents ?? cursorPriced.cents,
  );
  const approximate = snapshot.estimatedCents === null && combined.cents !== null;

  return (
    <div className="flex flex-col gap-6">
      <CycleFootnote snapshot={snapshot} />
      <section
        aria-labelledby="hero-subtitle"
        className="animate-rise relative overflow-hidden rounded-card border border-border bg-surface p-6"
      >
        {/* Pure decoration: an amber bloom behind the score. */}
        <span
          aria-hidden="true"
          // The keyframe animates opacity, so the tint lives in the colour.
          className="animate-glow pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-brand/20 blur-3xl"
        />

        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <p
              id="hero-subtitle"
              data-testid="hero-subtitle"
              className="text-small leading-small font-medium tracking-wide text-foreground-muted uppercase"
            >
              {heroSubtitle(snapshot)}
            </p>
            <p
              data-testid="estimated-total"
              className="mt-2 text-hero leading-hero font-semibold tracking-tight tabular-nums"
            >
              {formatEstimatedTotal(snapshot)}
            </p>
          </div>
          {combined.unpriced > 0 ? (
            <p
              data-testid="unpriced-note"
              className="rounded-full border border-warning bg-brand-subtle px-3 py-1 text-small leading-small font-medium text-warning"
            >
              {combined.unpriced} model{combined.unpriced === 1 ? "" : "s"} unpriced
              {approximate ? " · total is a floor" : ""}
            </p>
          ) : null}
        </div>

        {/* Who burned it: OMP versus Cursor, by spend, tokens as the fallback. */}
        <div
          aria-hidden="true"
          className="relative mt-5 flex h-2.5 gap-1 overflow-hidden rounded-full bg-surface-subtle"
        >
          <span
            className="animate-bar h-full origin-left rounded-full bg-source-omp"
            style={{ width: `${shares.omp}%` }}
          />
          <span
            className="animate-bar h-full origin-left rounded-full bg-source-cursor"
            style={{ width: `${shares.cursor}%` }}
          />
        </div>

        <div className="relative mt-4 border-t border-border pt-2">
          <SubtotalRow
            testId="omp-subtotal"
            label="OMP"
            dotClass="bg-source-omp"
            text={costText(snapshot.omp.estimatedCents, ompPriced)}
          />
          <SubtotalRow
            testId="cursor-subtotal"
            label={cursorLabel}
            dotClass="bg-source-cursor"
            text={costText(snapshot.cursor.estimatedCents, cursorPriced)}
          />
        </div>

        <p
          data-testid="token-breakdown"
          className="relative mt-3 font-mono text-small leading-small text-foreground-muted"
        >
          {tokenLine(snapshot.omp.tokens, snapshot.cursor.tokens)}
        </p>
      </section>
      {empty === null ? (
        <ModelTable rows={snapshot.models} />
      ) : (
        <p data-testid="empty-state" className="text-body text-foreground-secondary">
          {empty}
        </p>
      )}
      <CycleCard snapshot={snapshot} />
    </div>
  );
}
