/**
 * The Dashboard route body: one estimated total for the snapshot's period.
 *
 * This package never touches a filesystem, a network, the collectors, the
 * database or the sidecar. Both shells pass a `DashboardSnapshot` in; rendering
 * is all that happens here. The fetch cluster and nav belong to `AppShell`.
 */

import type { DashboardSnapshot } from "@prompt-burn/core";

/** Em dash for every unknown cost — never `$0`. */
const UNKNOWN_COST = "—";

/** Formats fractional cents as USD with 2 decimals: 1234.5 -> "$12.35". */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/** The combined total, or the em dash when any price is unknown. */
export function formatEstimatedTotal(snapshot: DashboardSnapshot): string {
  return snapshot.estimatedCents === null ? UNKNOWN_COST : formatCents(snapshot.estimatedCents);
}

export interface DashboardProps {
  snapshot: DashboardSnapshot;
}

/** The minimal dashboard: the estimated total. The hero card lands later. */
export function Dashboard({ snapshot }: DashboardProps) {
  return (
    <section aria-labelledby="estimated-total-label">
      <p
        id="estimated-total-label"
        className="text-small leading-small font-medium tracking-wide text-foreground-muted uppercase"
      >
        Estimated total
      </p>
      <p
        data-testid="estimated-total"
        className="text-display leading-display font-semibold tracking-tight tabular-nums"
      >
        {formatEstimatedTotal(snapshot)}
      </p>
    </section>
  );
}
