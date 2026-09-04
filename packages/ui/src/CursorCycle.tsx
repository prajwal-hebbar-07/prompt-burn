/**
 * The Cursor Pro cycle footnote above the hero.
 *
 * Cursor Pro reports cycle-to-date aggregates with no timestamps, so calendar
 * filters cannot touch them. This line exists to say that out loud: the cycle
 * window in the device timezone, and that period filters apply to OMP only. It
 * shows nothing in `events` mode, and never invents a window the collector has
 * not fetched yet.
 */

import { CURSOR_CYCLE_LABEL, type DashboardSnapshot } from "@prompt-burn/core";
import { formatCycleWindow } from "./format.js";

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
