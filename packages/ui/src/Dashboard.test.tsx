/**
 * The Dashboard body, rendered from typed `DashboardSnapshot` mocks — the same
 * view model `buildDashboardSnapshot` produces. No host, no protocol: the
 * component gets props and that is all it can reach. Chrome, nav and the fetch
 * cluster are covered in AppShell.test.tsx.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CursorSnapshot, DashboardSnapshot, UsageEvent } from "@prompt-burn/core";
import { buildDashboardSnapshot } from "@prompt-burn/core";
import { Dashboard, formatCents, formatEstimatedTotal } from "./index.js";

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
    expect(formatCents(1234.5)).toBe("$12.35");
    expect(formatCents(0.4)).toBe("$0.00");
  });

  it("renders the em dash for an unknown price, and $0.00 only when really zero", () => {
    expect(formatEstimatedTotal(snapshot([ompEvent()], null))).toBe("—");
    expect(formatEstimatedTotal(snapshot([], 0))).toBe("$0.00");
    expect(formatEstimatedTotal(snapshot([ompEvent()], 2421.775))).toBe("$24.22");
  });
});

describe("Dashboard", () => {
  it("renders the total from a never-fetched snapshot", () => {
    render(<Dashboard snapshot={snapshot([ompEvent()], null)} />);

    expect(screen.getByTestId("estimated-total").textContent).toBe("—");
    expect(screen.getByText("Estimated total")).toBeTruthy();
  });

  it("renders a dollar total once a mock provides one", () => {
    render(<Dashboard snapshot={snapshot([ompEvent()], 2421.775)} />);

    expect(screen.getByTestId("estimated-total").textContent).toBe("$24.22");
  });

  it("shows $0.00 for a fetched snapshot with no usage, not the em dash", () => {
    render(<Dashboard snapshot={snapshot([], 0)} />);

    expect(screen.getByTestId("estimated-total").textContent).toBe("$0.00");
  });
});
