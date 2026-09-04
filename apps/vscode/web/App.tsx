/**
 * The VS Code shell's state: one snapshot, one selected period, one in-flight
 * flag — the same policy the desktop window follows, over the extension-host
 * protocol instead of the Tauri sidecar.
 *
 * Fetch once when the tab opens, then only when the user asks. No timers, no
 * polling. While a fetch runs the previous snapshot stays on screen with its
 * status overwritten — the number never blanks and never drops to $0.
 *
 * Changing the period is not a fetch: it re-reads the snapshot for the new
 * filter and leaves the sources, the spinner and `lastSuccessAt` alone.
 *
 * ponytail: this policy is duplicated from `apps/desktop/web/App.tsx` because
 * the two shells differ only in transport. Extract a shared container if a
 * third shell shows up — two is not enough to pay for the indirection.
 */

import { useCallback, useEffect, useState } from "react";
import { buildDashboardSnapshot, type DashboardSnapshot, type PeriodFilter } from "@prompt-burn/core";
import { AppShell, type NewPriceInput, type SourceSettings } from "@prompt-burn/ui";
import { addPrice, fetchUsage, getSettings, getSnapshot, saveSettings } from "./host.js";

/** Paper's default wireframe is "This month"; product calls it a calendar month. */
const DEFAULT_PERIOD: PeriodFilter = { kind: "this_month" };

/** Before the first answer: the never-fetched surface — `—`, Not fetched yet. */
const NEVER_FETCHED: DashboardSnapshot = buildDashboardSnapshot({
  period: DEFAULT_PERIOD,
  ompEvents: [],
  cursor: { mode: "cycle_aggregate", cycleStart: "", cycleEnd: "", models: [] },
});

export function App() {
  const [snapshot, setSnapshot] = useState(NEVER_FETCHED);
  const [period, setPeriod] = useState(DEFAULT_PERIOD);
  const [fetching, setFetching] = useState(false);
  const [settings, setSettings] = useState<SourceSettings>();

  const refresh = useCallback(async (target: PeriodFilter) => {
    setFetching(true);
    try {
      const result = await fetchUsage();
      // Every source failed: nothing new is stored, so keep what is on screen
      // rather than re-reading the same rows.
      if (!result.omp.ok && !result.cursor.ok) {
        throw new Error(result.error ?? "the fetch failed");
      }
      const fetched = await getSnapshot(target);
      // Partial success still lands: the source that worked has new data and
      // the one that failed kept its previous rows, so only the status carries
      // the failure. The banner that reads it is commit 29.
      setSnapshot({
        ...fetched,
        fetch: {
          lastSuccessAt: result.at,
          status: result.ok ? "idle" : "error",
          ...(result.error === undefined ? {} : { error: result.error }),
        },
      });
      if (!result.ok) console.error("prompt-burn: partial fetch", result.error);
    } catch (error) {
      // The whole call failed: keep the last good snapshot on screen.
      console.error("prompt-burn: fetch failed", error);
    } finally {
      setFetching(false);
    }
  }, []);

  /** Re-aggregates the stored rows for one period. Not a fetch: nothing syncs. */
  const reloadSnapshot = useCallback(async (target: PeriodFilter) => {
    try {
      const fetched = await getSnapshot(target);
      // The previous fetch bookkeeping survives: nothing was fetched here.
      setSnapshot((previous) => ({ ...fetched, fetch: previous.fetch }));
    } catch (error) {
      console.error("prompt-burn: snapshot failed", error);
    }
  }, []);

  /** A period change re-aggregates stored events; it syncs nothing. */
  const changePeriod = useCallback(
    (target: PeriodFilter) => {
      setPeriod(target);
      void reloadSnapshot(target);
    },
    [reloadSnapshot],
  );

  const saveSources = useCallback((next: SourceSettings) => {
    void saveSettings(next).then(setSettings, (error: unknown) =>
      console.error("prompt-burn: settings write failed", error),
    );
  }, []);

  /**
   * A new rate re-prices tokens that are already stored, so this re-reads the
   * snapshot instead of fetching: no source is contacted, no row is rewritten.
   */
  const applyPrice = useCallback(
    (price: NewPriceInput) => {
      void addPrice(price)
        .then(() => reloadSnapshot(period))
        .catch((error: unknown) => console.error("prompt-burn: price insert failed", error));
    },
    [period, reloadSnapshot],
  );

  useEffect(() => {
    void refresh(DEFAULT_PERIOD);
  }, [refresh]);

  // Read after the open fetch is already in flight: the tab must not wait on
  // settings to show a number.
  useEffect(() => {
    void getSettings().then(setSettings, (error: unknown) =>
      console.error("prompt-burn: settings read failed", error),
    );
  }, []);

  const shown: DashboardSnapshot = fetching
    ? { ...snapshot, fetch: { ...snapshot.fetch, status: "fetching" } }
    : snapshot;

  return (
    <AppShell
      snapshot={shown}
      period={period}
      onPeriodChange={changePeriod}
      onFetch={() => void refresh(period)}
      settings={{ ...settings, onSave: saveSources, onAddPrice: applyPrice }}
    />
  );
}
