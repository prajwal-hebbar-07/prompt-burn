/**
 * App chrome for both hosts: title, trust line, fetch cluster and the two-route
 * nav. The Dashboard body and the Settings destination hang off it.
 *
 * Props only, like the rest of this package: the shell reads `snapshot.fetch`
 * for its status label and calls `onFetch` — the host owns the actual fetch.
 * Which route is showing is view state, so it lives here.
 *
 * Laid out for a wide column (desktop window, VS Code editor tab), capped at
 * the 1100px content token.
 */

import { useEffect, useState } from "react";
import type { DashboardSnapshot } from "@prompt-burn/core";
import { Dashboard } from "./Dashboard.js";

/** Always visible, on every route — docs/product.md Trust. */
const TRUST_LINE = "Local only · nothing leaves this device";

const ROUTES = ["Dashboard", "Settings"] as const;

export type Route = (typeof ROUTES)[number];

/** `Fetched 3 min ago`, per docs/product.md; "just now" under a minute. */
export function fetchedAgoLabel(iso: string, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 1000));
  if (seconds < 60) return "Fetched just now";
  const minutes = Math.round(seconds / 60);
  return `Fetched ${minutes} min ago`;
}

/** `Not fetched yet`, `Fetching…` or `Fetched N min ago` — never an empty string. */
export function fetchStatusLabel(snapshot: DashboardSnapshot, now: Date): string {
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

/** Settings is reachable now; its sections land with the settings commit. */
function Settings() {
  return (
    <section aria-labelledby="settings-heading">
      <h2 id="settings-heading" className="text-section leading-section font-semibold">
        Settings
      </h2>
      <p className="mt-2 text-body leading-body text-foreground-secondary">
        Sources, pricing and unknown models are configured here.
      </p>
    </section>
  );
}

export interface AppShellProps {
  snapshot: DashboardSnapshot;
  /** Clicking "Fetch data" — the host owns the actual fetch. */
  onFetch?: () => void;
  /** Injectable clock for the relative label; defaults to the wall clock. */
  now?: () => Date;
}

export function AppShell({ snapshot, onFetch, now }: AppShellProps) {
  const [route, setRoute] = useState<Route>("Dashboard");
  // The hook always runs; an injected clock only overrides what it reads.
  const ticking = useRoughlyMinuteClock();
  const fetching = snapshot.fetch.status === "fetching";

  return (
    <div className="min-h-screen bg-background font-sans text-body leading-body text-foreground">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-content flex-wrap items-start justify-between gap-4 px-6 pt-6">
          <div>
            <h1 className="text-title leading-title font-semibold tracking-tight">Prompt Burn</h1>
            <p className="mt-1 text-small leading-small text-foreground-muted">{TRUST_LINE}</p>
          </div>
          <div className="flex items-center gap-3">
            {fetching ? (
              <span
                data-testid="spinner"
                aria-hidden="true"
                className="size-3 animate-spin rounded-full border-2 border-border border-t-brand"
              />
            ) : null}
            <span data-testid="fetch-status" className="text-small text-foreground-secondary">
              {fetchStatusLabel(snapshot, now ? now() : ticking)}
            </span>
            <button
              type="button"
              onClick={onFetch}
              disabled={fetching}
              className="flex items-center gap-2 rounded-control border border-brand bg-brand-subtle px-3 py-1.5 text-small font-medium text-brand disabled:opacity-50"
            >
              <span aria-hidden="true">↻</span>
              Fetch data
            </button>
          </div>
        </div>
        <nav aria-label="Views" className="mx-auto flex max-w-content gap-6 px-6">
          {ROUTES.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setRoute(name)}
              aria-current={route === name ? "page" : undefined}
              className={`-mb-px border-b-2 py-3 text-body font-medium ${
                route === name
                  ? "border-brand text-brand"
                  : "border-transparent text-foreground-secondary"
              }`}
            >
              {name}
            </button>
          ))}
        </nav>
      </header>
      <main aria-label={`Prompt Burn ${route.toLowerCase()}`} className="mx-auto max-w-content px-6 py-8">
        {route === "Dashboard" ? <Dashboard snapshot={snapshot} /> : <Settings />}
      </main>
    </div>
  );
}
