/**
 * The shared React surface: one screen, props only.
 *
 * This package never touches a filesystem, a network, the collectors, the
 * database or the sidecar. Both shells pass a `DashboardSnapshot` in and wire
 * `onFetch` to their own host plumbing (desktop: sidecar protocol; VS Code:
 * extension host). Rendering is all that happens here.
 */

import { useEffect, useState } from "react";
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

/** `Fetched 3 min ago`, per docs/product.md; "just now" under a minute. */
export function fetchedAgoLabel(iso: string, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "Fetched just now";
  const minutes = Math.round(seconds / 60);
  return `Fetched ${minutes} min ago`;
}

/** `Not fetched yet`, `Fetching…` or `Fetched N min ago` — never an empty string. */
export function fetchStatusLabel(
  snapshot: DashboardSnapshot,
  now: Date,
): string {
  if (snapshot.fetch.status === "fetching") return "Fetching…";
  if (snapshot.fetch.status === "error") return "Not fetched yet";
  const at = snapshot.fetch.lastSuccessAt;
  return at === null ? "Not fetched yet" : fetchedAgoLabel(at, now);
}

/** Re-renders on an interval so `Fetched N min ago` stays roughly current. */
function useRoughlyMinuteClock(tickMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // ponytail: a bare interval on mount is enough for the one timed label;
    // make it configurable if a second timed surface ever appears.
    const timer = setInterval(() => setNow(new Date()), tickMs);
    return () => clearInterval(timer);
  }, [tickMs]);
  return now;
}

export interface DashboardProps {
  snapshot: DashboardSnapshot;
  /** Clicking "Fetch data" — the host owns the actual fetch. */
  onFetch?: () => void;
  /** Injectable clock for the relative label; defaults to the wall clock. */
  now?: () => Date;
}

/** The minimal dashboard: one estimated total, a Fetch data button, a label. */
export function Dashboard({ snapshot, onFetch, now }: DashboardProps) {
  // The hook always runs; an injected clock only overrides what it reads.
  const ticking = useRoughlyMinuteClock();
  const label = fetchStatusLabel(snapshot, now ? now() : ticking);
  return (
    <main aria-label="Prompt Burn dashboard" className="mx-auto max-w-xl p-8">
      <p className="text-sm text-stone-500">Estimated total</p>
      <p data-testid="estimated-total" className="text-4xl font-semibold tabular-nums">
        {formatEstimatedTotal(snapshot)}
      </p>
      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={onFetch}
          disabled={snapshot.fetch.status === "fetching"}
          className="rounded-md bg-stone-800 px-3 py-1.5 text-sm text-white disabled:opacity-50"
        >
          Fetch data
        </button>
        {snapshot.fetch.status === "fetching" ? (
          <span
            data-testid="spinner"
            aria-hidden="true"
            className="size-3 animate-spin rounded-full border-2 border-stone-300 border-t-stone-700"
          />
        ) : null}
        <span data-testid="fetch-status" className="text-sm text-stone-500">
          {label}
        </span>
      </div>
    </main>
  );
}