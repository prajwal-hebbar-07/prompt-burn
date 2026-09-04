/**
 * The Dashboard route body: the hero totals card, then the by-model table.
 *
 * Combined estimate, then both source subtotals — always both, never deduped,
 * never re-derived here. Cursor Pro is cycle-to-date whatever the period is, so
 * when `mixedPeriod` is set the subtitle names both scopes; the cycle's own
 * dates are the cycle banner's job, not this card's.
 *
 * This package never touches a filesystem, a network, the collectors, the
 * database or the sidecar: hosts pass a `DashboardSnapshot` in and rendering is
 * all that happens here.
 */

import { CURSOR_CYCLE_LABEL, type DashboardSnapshot, type TokenCounts } from "@prompt-burn/core";
import { formatCost, formatTokens } from "./format.js";
import { ModelTable } from "./ModelTable.js";
import { periodLabel } from "./PeriodBar.js";

/** The combined total, or the em dash when any price is unknown. */
export function formatEstimatedTotal(snapshot: DashboardSnapshot): string {
  return formatCost(snapshot.estimatedCents);
}

/** `Tokens: 1.2M in · 340K out · 89K cache` — cache is read plus write. */
function tokenLine(...parts: TokenCounts[]): string {
  const sum = (pick: (tokens: TokenCounts) => number) =>
    parts.reduce((total, tokens) => total + pick(tokens), 0);
  const input = sum((t) => t.input);
  const output = sum((t) => t.output);
  const cache = sum((t) => (t.cacheRead ?? 0) + (t.cacheWrite ?? 0));
  return `Tokens: ${formatTokens(input)} in · ${formatTokens(output)} out · ${formatTokens(cache)} cache`;
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

interface SubtotalRowProps {
  testId: string;
  label: string;
  /** Token class for the source dot; the label always travels with it. */
  dotClass: string;
  cents: number | null;
}

/** One source line: colored dot, text label, amount. Never hidden. */
function SubtotalRow({ testId, label, dotClass, cents }: SubtotalRowProps) {
  return (
    <div data-testid={testId} className="flex items-center justify-between py-1">
      <span className="flex items-center gap-2 text-body">
        <span aria-hidden="true" className={`size-2 rounded-full ${dotClass}`} />
        {label}
      </span>
      <span className="text-body font-medium tabular-nums">{formatCost(cents)}</span>
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

  return (
    <>
      <section
        aria-labelledby="hero-subtitle"
        className="rounded-card border border-border bg-surface p-6"
      >
        <p
          id="hero-subtitle"
          data-testid="hero-subtitle"
          className="text-small leading-small text-foreground-muted"
        >
          {heroSubtitle(snapshot)}
        </p>
        <p
          data-testid="estimated-total"
          className="mt-1 text-display leading-display font-semibold tracking-tight tabular-nums"
        >
          {formatEstimatedTotal(snapshot)}
        </p>

        <div className="mt-4 border-t border-border pt-3">
          <SubtotalRow
            testId="omp-subtotal"
            label="OMP"
            dotClass="bg-source-omp"
            cents={snapshot.omp.estimatedCents}
          />
          <SubtotalRow
            testId="cursor-subtotal"
            label={cursorLabel}
            dotClass="bg-source-cursor"
            cents={snapshot.cursor.estimatedCents}
          />
        </div>

        <p
          data-testid="token-breakdown"
          className="mt-3 text-small leading-small text-foreground-muted"
        >
          {tokenLine(snapshot.omp.tokens, snapshot.cursor.tokens)}
        </p>
      </section>
      <div className="mt-6">
        <ModelTable rows={snapshot.models} />
      </div>
    </>
  );
}
