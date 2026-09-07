/**
 * The Cursor footnote above the hero.
 *
 * Cursor's aggregates carry no timestamps, but its API does narrow them to a
 * window, so this line says which of the two happened: the billing cycle it is
 * quoting and that period filters reach OMP only, or the cycle window as
 * context while the numbers on screen follow the period. It shows nothing in
 * `events` mode, and never invents a window the collector has not fetched yet.
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
 * to OMP only · Cursor is not in the total`, or, once Cursor has answered for
 * the period itself, `Cursor billing cycle Aug 26 – Sep 26, 2026 · Cursor
 * follows the period filter`. The window stays visible either way — product
 * keeps the cycle footnote up. The Projects route has no Cursor totals at all,
 * and says so on its own screen.
 */
export function CycleFootnote({ snapshot }: CycleProps) {
  if (snapshot.cursor.mode !== "cycle_aggregate") return null;

  const window = formatCycleWindow(snapshot.cursor.cycleStart, snapshot.cursor.cycleEnd);
  const parts = snapshot.cursor.window
    ? [
        `Cursor billing cycle${window ? ` ${window}` : ""}`,
        "Cursor follows the period filter",
      ]
    : [`Cursor shows ${cycleLabelOf(snapshot).toLowerCase()}${window ? ` (${window})` : ""}`];
  // Cycle-wide numbers against a narrower period: they are on screen, on their
  // own row, and out of the hero total. Both halves of that are worth saying.
  if (snapshot.mixedPeriod) {
    parts.push("period filters apply to OMP only", "Cursor is not in the total");
  }

  return (
    <p data-testid="cycle-footnote" className={`${CALLOUT} text-small leading-small`}>
      {parts.join(" · ")}
    </p>
  );
}
