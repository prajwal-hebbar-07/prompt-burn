/**
 * The Cursor Pro cycle surfaces: the mixed-scope footnote above the hero, and
 * the cycle card under the table.
 *
 * Cursor Pro reports cycle-to-date aggregates with no timestamps, so calendar
 * filters cannot touch them. Both surfaces exist to say that out loud: the
 * cycle window in the device timezone, and that period filters apply to OMP
 * only. Neither shows anything in `events` mode, and neither invents a window
 * the collector has not fetched yet.
 */

import { CURSOR_CYCLE_LABEL, type DashboardSnapshot } from "@prompt-burn/core";
import { formatCost, formatCycleWindow, tokenLine } from "./format.js";

/** Violet is Cursor's identity token, and it always travels with text. */
const CALLOUT = "rounded-card bg-source-cursor-subtle px-4 py-3 text-source-cursor";

interface CycleProps {
  snapshot: DashboardSnapshot;
}

function cycleLabelOf(snapshot: DashboardSnapshot): string {
  return snapshot.cursor.cycleLabel ?? CURSOR_CYCLE_LABEL;
}

/**
 * `Cursor shows cycle to date (Aug 26 – Sep 26, 2026) · period filters apply
 * to OMP only`. The window stays visible on all-time too, where the periods do
 * not clash — product keeps the cycle footnote up either way.
 */
export function CycleFootnote({ snapshot }: CycleProps) {
  if (snapshot.cursor.mode !== "cycle_aggregate") return null;

  const window = formatCycleWindow(snapshot.cursor.cycleStart, snapshot.cursor.cycleEnd);
  const parts = [
    `Cursor shows ${cycleLabelOf(snapshot).toLowerCase()}${window ? ` (${window})` : ""}`,
  ];
  if (snapshot.mixedPeriod) parts.push("period filters apply to OMP only");

  return (
    <p data-testid="cycle-footnote" className={`${CALLOUT} text-small leading-small`}>
      {parts.join(" · ")}
    </p>
  );
}

/** The cycle rollup as its own card: window, tokens, estimated cost, caveat. */
export function CycleCard({ snapshot }: CycleProps) {
  if (snapshot.cursor.mode !== "cycle_aggregate") return null;

  const window = formatCycleWindow(snapshot.cursor.cycleStart, snapshot.cursor.cycleEnd);

  return (
    <section
      data-testid="cycle-card"
      aria-labelledby="cycle-card-title"
      className="rounded-card border border-border bg-surface p-6"
    >
      <div className="flex items-baseline justify-between gap-4">
        <h3
          id="cycle-card-title"
          className="flex items-center gap-2 text-section leading-section font-semibold"
        >
          <span aria-hidden="true" className="size-2 rounded-full bg-source-cursor" />
          Cursor · {cycleLabelOf(snapshot)}
        </h3>
        <span data-testid="cycle-cost" className="text-body font-medium tabular-nums">
          {formatCost(snapshot.cursor.estimatedCents)}
        </span>
      </div>
      {window ? (
        <p data-testid="cycle-window" className="mt-1 text-small leading-small text-source-cursor">
          {window}
        </p>
      ) : null}
      <p className="mt-2 text-small leading-small text-foreground-muted">
        {tokenLine(snapshot.cursor.tokens)}
      </p>
      <p className="mt-3 text-small leading-small text-foreground-muted">
        Per-day filtering unavailable without Enterprise API key
      </p>
    </section>
  );
}
