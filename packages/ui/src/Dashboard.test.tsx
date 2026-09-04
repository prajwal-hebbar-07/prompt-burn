/**
 * The minimal surface, rendered from typed `DashboardSnapshot` mocks — the
 * same view model `buildDashboardSnapshot` produces. No host, no protocol:
 * the component gets props and that is all it can reach.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CursorSnapshot, DashboardSnapshot, UsageEvent } from "@prompt-burn/core";
import { buildDashboardSnapshot } from "@prompt-burn/core";
import { Dashboard, fetchStatusLabel, formatCents, formatEstimatedTotal } from "./index.js";

afterEach(cleanup);

const EMPTY_CURSOR: CursorSnapshot = {
  mode: "cycle_aggregate",
  cycleStart: "",
  cycleEnd: "",
  models: [],
};

/** A snapshot straight from the real aggregator — typed, not ad hoc. */
function snapshot(events: UsageEvent[], estimatedCents: number | null = null): DashboardSnapshot {
  const base = buildDashboardSnapshot({
    period: { kind: "all_time" },
    ompEvents: events,
    cursor: EMPTY_CURSOR,
  });
  return { ...base, estimatedCents };
}

/** One OMP event: 2 input, 105 output tokens on claude-opus-5. */
function ompEvent(): UsageEvent {
  return {
    id: "omp:s1:line1",
    source: "omp",
    timestamp: "2026-09-02T08:31:31.505Z",
    model: "claude-opus-5",
    rawModel: "claude-opus-5",
    tokens: { input: 2, output: 105, cacheRead: 37378, cacheWrite: 463 },
    sessionId: "s1",
  };
}

describe("formatting", () => {
  it("keeps fractional cents and never rounds to $0", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(0.4)).toBe("$0.00");
    expect(formatCents(123_456.7)).toBe("$1,234.57");
  });

  it("renders the em dash for an unknown price, and $0.00 only when really zero", () => {
    expect(formatEstimatedTotal(snapshot([ompEvent()], null))).toBe("—");
    expect(formatEstimatedTotal(snapshot([ompEvent()], 0))).toBe("$0.00");
    expect(formatEstimatedTotal(snapshot([ompEvent()], 2421.775))).toBe("$24.22");
  });

  it("labels never-fetched, fetching and error as Not fetched yet / Fetching…", () => {
    const now = new Date("2026-09-04T12:00:00Z");
    const base = { fetch: { lastSuccessAt: null as string | null, status: "idle" as const } };
    expect(fetchStatusLabel(snapshot([], null), now)).toBe("Not fetched yet");
    expect(fetchStatusLabel({ ...snapshot([], null), fetch: { ...base.fetch, status: "fetching" } }, now)).toBe("Fetching…");
    // An error keeps the old data visible; its status text does not invent a time.
    expect(fetchStatusLabel({ ...snapshot([], null), fetch: { ...base.fetch, status: "error", error: "boom" } }, now)).toBe("Not fetched yet");
  });

  it("labels a successful fetch relatively, refreshing without refetching", () => {
    const now = new Date("2026-09-04T12:00:00Z");
    const fetched = snapshot([], 500);
    expect(fetchStatusLabel({ ...fetched, fetch: { lastSuccessAt: "2026-09-04T11:57:00Z", status: "idle" } }, now)).toBe("Fetched 3 min ago");
    expect(fetchStatusLabel({ ...fetched, fetch: { lastSuccessAt: "2026-09-04T11:59:40Z", status: "idle" } }, now)).toBe("Fetched just now");
  });
});

describe("Dashboard", () => {
  it("renders the total from a never-fetched snapshot", () => {
    render(<Dashboard snapshot={snapshot([ompEvent()], null)} />);

    expect(screen.getByTestId("estimated-total").textContent).toBe("—");
    expect(
      (screen.getByRole("button", { name: "Fetch data" }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.getByTestId("fetch-status").textContent).toBe("Not fetched yet");
  });

  it("renders a dollar total once a mock provides one", () => {
    render(<Dashboard snapshot={snapshot([ompEvent()], 2421.775)} />);

    expect(screen.getByTestId("estimated-total").textContent).toBe("$24.22");
  });

  it("renders the relative label against an injected clock", () => {
    const fetched = {
      ...snapshot([ompEvent()], 2421.775),
      fetch: { lastSuccessAt: "2026-09-04T11:57:00Z", status: "idle" as const },
    };
    render(<Dashboard snapshot={fetched} now={() => new Date("2026-09-04T12:00:00Z")} />);

    expect(screen.getByTestId("fetch-status").textContent).toBe("Fetched 3 min ago");
    expect(screen.getByTestId("estimated-total").textContent).toBe("$24.22");
  });

  it("invokes onFetch when Fetch data is clicked, and nothing else", async () => {
    const onFetch = vi.fn();
    const user = userEvent.setup();
    render(<Dashboard snapshot={snapshot([ompEvent()], 100)} onFetch={onFetch} />);

    await user.click(screen.getByRole("button", { name: "Fetch data" }));
    expect(onFetch).toHaveBeenCalledTimes(1);
  });

  it("disables the button while the snapshot says fetching", () => {
    const fetching = {
      ...snapshot([], null),
      fetch: { lastSuccessAt: null as string | null, status: "fetching" as const },
    };
    render(<Dashboard snapshot={fetching} onFetch={vi.fn()} />);
    expect(
      (screen.getByRole("button", { name: "Fetch data" }) as HTMLButtonElement).disabled,
    ).toBe(true);

    expect(screen.getByTestId("fetch-status").textContent).toBe("Fetching…");
  });

  it("shows $0.00 for a fetched snapshot with no usage, not the em dash", () => {
    const zero = {
      ...snapshot([], 0),
      fetch: { lastSuccessAt: "2026-09-04T11:00:00Z", status: "idle" as const },
    };
    render(<Dashboard snapshot={zero} />);

    expect(screen.getByTestId("estimated-total").textContent).toBe("$0.00");
    expect(screen.getByTestId("fetch-status").textContent).toContain("Fetched");
  });
});