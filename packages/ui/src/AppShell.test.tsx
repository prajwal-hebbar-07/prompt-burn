/**
 * The chrome both hosts render: title, trust line, fetch cluster, two routes.
 * Snapshots are typed `DashboardSnapshot` mocks built by the real aggregator,
 * and the fetch-cluster expectations are the ones the single-screen surface
 * carried before the shell existed.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardSnapshot } from "@prompt-burn/core";
import { buildDashboardSnapshot } from "@prompt-burn/core";
import { AppShell, fetchStatusLabel } from "./index.js";

afterEach(cleanup);

const TRUST_LINE = "Local only · nothing leaves this device";

/** A snapshot straight from the real aggregator, with the fetch state under test. */
function snapshot(
  fetch: DashboardSnapshot["fetch"],
  estimatedCents: number | null = 2421.775,
): DashboardSnapshot {
  const base = buildDashboardSnapshot({
    period: { kind: "all_time" },
    ompEvents: [],
    cursor: { mode: "cycle_aggregate", cycleStart: "", cycleEnd: "", models: [] },
  });
  return { ...base, estimatedCents, fetch };
}

const NEVER_FETCHED: DashboardSnapshot["fetch"] = { lastSuccessAt: null, status: "idle" };
const FETCHING: DashboardSnapshot["fetch"] = { lastSuccessAt: null, status: "fetching" };
const FETCHED: DashboardSnapshot["fetch"] = {
  lastSuccessAt: "2026-09-04T11:57:00Z",
  status: "idle",
};

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("the fetch status label", () => {
  it("labels never-fetched, fetching and error as Not fetched yet / Fetching…", () => {
    const now = new Date("2026-09-04T12:00:00Z");
    expect(fetchStatusLabel(snapshot(NEVER_FETCHED), now)).toBe("Not fetched yet");
    expect(fetchStatusLabel(snapshot(FETCHING), now)).toBe("Fetching…");
    expect(fetchStatusLabel(snapshot({ lastSuccessAt: null, status: "error" }), now)).toBe(
      "Not fetched yet",
    );
  });

  it("labels a successful fetch relatively, refreshing without refetching", () => {
    expect(fetchStatusLabel(snapshot(FETCHED), new Date("2026-09-04T11:57:20Z"))).toBe(
      "Fetched just now",
    );
    expect(fetchStatusLabel(snapshot(FETCHED), new Date("2026-09-04T12:00:00Z"))).toBe(
      "Fetched 3 min ago",
    );
    expect(fetchStatusLabel(snapshot(FETCHED), new Date("2026-09-04T12:57:00Z"))).toBe(
      "Fetched 60 min ago",
    );
  });
});

describe("chrome", () => {
  it("shows the title, the trust line and the fetch cluster", () => {
    render(<AppShell snapshot={snapshot(NEVER_FETCHED, null)} />);

    expect(screen.getByRole("heading", { name: "Prompt Burn", level: 1 })).toBeTruthy();
    expect(screen.getByText(TRUST_LINE)).toBeTruthy();
    expect(button("Fetch data").disabled).toBe(false);
    expect(screen.getByTestId("fetch-status").textContent).toBe("Not fetched yet");
  });

  it("keeps the trust line and the fetch cluster visible on Settings", async () => {
    const user = userEvent.setup();
    render(<AppShell snapshot={snapshot(FETCHED)} now={() => new Date("2026-09-04T12:00:00Z")} />);

    await user.click(button("Settings"));

    expect(screen.getByText(TRUST_LINE)).toBeTruthy();
    expect(button("Fetch data")).toBeTruthy();
    expect(screen.getByTestId("fetch-status").textContent).toBe("Fetched 3 min ago");
  });

  it("invokes onFetch when Fetch data is clicked, and nothing else", async () => {
    const onFetch = vi.fn();
    const user = userEvent.setup();
    render(<AppShell snapshot={snapshot(NEVER_FETCHED)} onFetch={onFetch} />);

    await user.click(button("Fetch data"));
    expect(onFetch).toHaveBeenCalledTimes(1);
  });

  it("disables the button and spins while the snapshot says fetching", () => {
    render(<AppShell snapshot={snapshot(FETCHING)} onFetch={vi.fn()} />);
    expect(button("Fetch data").disabled).toBe(true);
    expect(screen.getByTestId("fetch-status").textContent).toBe("Fetching…");
    expect(screen.getByTestId("spinner")).toBeTruthy();

    cleanup();
    render(<AppShell snapshot={snapshot(NEVER_FETCHED)} onFetch={vi.fn()} />);
    expect(screen.queryByTestId("spinner")).toBeNull();
  });
});

describe("nav", () => {
  it("opens on the Dashboard and marks it current", () => {
    render(<AppShell snapshot={snapshot(FETCHED)} />);

    expect(screen.getByTestId("estimated-total").textContent).toBe("$24.22");
    expect(button("Dashboard").getAttribute("aria-current")).toBe("page");
    expect(button("Settings").getAttribute("aria-current")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
  });

  it("switches to Settings and back without touching the snapshot", async () => {
    const user = userEvent.setup();
    render(<AppShell snapshot={snapshot(FETCHED)} />);

    await user.click(button("Settings"));
    expect(screen.getByRole("heading", { name: "Settings", level: 2 })).toBeTruthy();
    expect(screen.queryByTestId("estimated-total")).toBeNull();
    expect(button("Settings").getAttribute("aria-current")).toBe("page");

    await user.click(button("Dashboard"));
    expect(screen.getByTestId("estimated-total").textContent).toBe("$24.22");
    expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
  });
});

describe("the period bar", () => {
  it("is a Dashboard control: present there, absent on Settings", async () => {
    const user = userEvent.setup();
    render(<AppShell snapshot={snapshot(FETCHED)} period={{ kind: "this_month" }} />);

    expect(screen.getByRole("group", { name: "Period" })).toBeTruthy();
    expect(button("This month").getAttribute("aria-pressed")).toBe("true");

    await user.click(button("Settings"));
    expect(screen.queryByRole("group", { name: "Period" })).toBeNull();
  });

  it("hands the chosen period to the host without touching fetch", async () => {
    const onPeriodChange = vi.fn();
    const onFetch = vi.fn();
    const user = userEvent.setup();
    render(
      <AppShell
        snapshot={snapshot(FETCHED)}
        period={{ kind: "this_month" }}
        onPeriodChange={onPeriodChange}
        onFetch={onFetch}
      />,
    );

    await user.click(button("Today"));

    expect(onPeriodChange).toHaveBeenCalledWith({ kind: "today" });
    expect(onFetch).not.toHaveBeenCalled();
    // The snapshot on screen is still the old one; the host swaps it in.
    expect(screen.getByTestId("estimated-total").textContent).toBe("$24.22");
  });
});
