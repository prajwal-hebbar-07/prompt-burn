/**
 * The desktop shell's state: one snapshot, one in-flight flag.
 *
 * Fetch once when the window opens, then only when the user asks. No timers,
 * no polling. While a fetch runs the previous snapshot stays on screen with its
 * status overwritten — the number never blanks and never drops to $0.
 */

import { useCallback, useEffect, useState } from "react";
import { buildDashboardSnapshot, type DashboardSnapshot } from "@prompt-burn/core";
import { AppShell } from "@prompt-burn/ui";
import { fetchUsage, getSnapshot } from "./sidecar.js";

/** Before the first answer: the never-fetched surface — `—`, Not fetched yet. */
const NEVER_FETCHED: DashboardSnapshot = buildDashboardSnapshot({
  period: { kind: "all_time" },
  ompEvents: [],
  cursor: { mode: "cycle_aggregate", cycleStart: "", cycleEnd: "", models: [] },
});

export function App() {
  const [snapshot, setSnapshot] = useState(NEVER_FETCHED);
  const [fetching, setFetching] = useState(false);

  const refresh = useCallback(async () => {
    setFetching(true);
    try {
      const result = await fetchUsage();
      if (!result.ok) throw new Error(result.error ?? "the OMP sync failed");
      const fetched = await getSnapshot();
      // The aggregate carries no fetch bookkeeping; the host that fetched owns
      // it, so `lastSuccessAt` comes from the sync's own timestamp.
      setSnapshot({ ...fetched, fetch: { lastSuccessAt: result.at, status: "idle" } });
    } catch (error) {
      // Keep the last good snapshot on screen. The failure banner is commit 29.
      console.error("prompt-burn: fetch failed", error);
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const shown: DashboardSnapshot = fetching
    ? { ...snapshot, fetch: { ...snapshot.fetch, status: "fetching" } }
    : snapshot;

  return <AppShell snapshot={shown} onFetch={() => void refresh()} />;
}