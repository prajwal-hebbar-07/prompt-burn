/**
 * The desktop shell's state: one snapshot, one selected period, one in-flight
 * flag.
 *
 * Fetch once when the window opens, then only when the user asks. No timers,
 * no polling. While a fetch runs the previous snapshot stays on screen with its
 * status overwritten — the number never blanks and never drops to $0.
 *
 * Changing the period is not a fetch: it re-reads the snapshot for the new
 * filter and leaves the sources, the spinner and `lastSuccessAt` alone.
 */

import { useCallback, useEffect, useState } from "react";
import { buildDashboardSnapshot, type DashboardSnapshot, type PeriodFilter } from "@prompt-burn/core";
import { AppShell } from "@prompt-burn/ui";
import { fetchUsage, getSnapshot } from "./sidecar.js";

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

  /** A period change re-aggregates stored events; it syncs nothing. */
  const changePeriod = useCallback((target: PeriodFilter) => {
    setPeriod(target);
    void (async () => {
      try {
        const fetched = await getSnapshot(target);
        // The previous fetch bookkeeping survives: nothing was fetched here.
        setSnapshot((previous) => ({ ...fetched, fetch: previous.fetch }));
      } catch (error) {
        console.error("prompt-burn: snapshot failed", error);
      }
    })();
  }, []);

  useEffect(() => {
    void refresh(DEFAULT_PERIOD);
  }, [refresh]);

  const shown: DashboardSnapshot = fetching
    ? { ...snapshot, fetch: { ...snapshot.fetch, status: "fetching" } }
    : snapshot;

  return (
    <AppShell
      snapshot={shown}
      period={period}
      onPeriodChange={changePeriod}
      onFetch={() => void refresh(period)}
    />
  );
}
