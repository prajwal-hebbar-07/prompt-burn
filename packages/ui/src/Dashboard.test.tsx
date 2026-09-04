/**
 * The hero totals card, rendered from typed `DashboardSnapshot` mocks — the
 * same view model `buildDashboardSnapshot` produces. The review focus is the
 * copy when scopes differ: Cursor Pro is cycle-to-date whatever period the user
 * picked, and the subtitle has to say so for every mixed period.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
  CursorSnapshot,
  DashboardSnapshot,
  PeriodFilter,
  UsageEvent,
} from "@prompt-burn/core";
import { buildDashboardSnapshot } from "@prompt-burn/core";
import {
  Dashboard,
  formatCents,
  formatEstimatedTotal,
  formatTokens,
  heroSubtitle,
} from "./index.js";

afterEach(cleanup);

const EMPTY_CURSOR: CursorSnapshot = {
  mode: "cycle_aggregate",
  cycleStart: "2026-08-15T00:00:00.000Z",
  cycleEnd: "2026-09-15T00:00:00.000Z",
  models: [],
};

/** A cycle-to-date Cursor answer: 900K in, 40K out, no cache keys. */
const CURSOR_WITH_USAGE: CursorSnapshot = {
  ...EMPTY_CURSOR,
  models: [{ model: "claude-4.5-sonnet", tokens: { input: 900_000, output: 40_000 } }],
};

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

interface Costs {
  combined?: number | null;
  omp?: number | null;
  cursor?: number | null;
}

/** A snapshot straight from the real aggregator, with prices injected. */
function snapshot(
  period: PeriodFilter = { kind: "all_time" },
  events: UsageEvent[] = [],
  cursor: CursorSnapshot = EMPTY_CURSOR,
  costs: Costs = {},
): DashboardSnapshot {
  const base = buildDashboardSnapshot({
    period,
    ompEvents: events,
    cursor,
    now: new Date("2026-09-02T12:00:00.000Z"),
  });
  return {
    ...base,
    estimatedCents: costs.combined ?? null,
    omp: { ...base.omp, estimatedCents: costs.omp ?? null },
    cursor: { ...base.cursor, estimatedCents: costs.cursor ?? null },
  };
}

describe("formatting", () => {
  it("keeps fractional cents and never rounds to $0", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(1234.5)).toBe("$12.35");
    expect(formatCents(0.4)).toBe("$0.00");
  });

  it("renders the em dash for an unknown price, and $0.00 only when really zero", () => {
    expect(formatEstimatedTotal(snapshot())).toBe("—");
    expect(formatEstimatedTotal(snapshot(undefined, [], EMPTY_CURSOR, { combined: 0 }))).toBe(
      "$0.00",
    );
    expect(
      formatEstimatedTotal(snapshot(undefined, [], EMPTY_CURSOR, { combined: 2421.775 })),
    ).toBe("$24.22");
  });

  it("compacts token counts the way the designs do", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(890)).toBe("890");
    expect(formatTokens(89_000)).toBe("89K");
    expect(formatTokens(340_500)).toBe("340.5K");
    expect(formatTokens(1_200_000)).toBe("1.2M");
    expect(formatTokens(2_000_000)).toBe("2M");
  });
});

describe("the mixed-scope subtitle", () => {
  it("names both scopes for every period Cursor cannot follow", () => {
    expect(heroSubtitle(snapshot({ kind: "today" }))).toBe(
      "Estimated total · OMP: Today · Cursor: cycle to date",
    );
    expect(heroSubtitle(snapshot({ kind: "this_month" }))).toBe(
      "Estimated total · OMP: This month · Cursor: cycle to date",
    );
    expect(heroSubtitle(snapshot({ kind: "range", start: "2026-08-01", end: "2026-08-15" }))).toBe(
      "Estimated total · OMP: Date range · Cursor: cycle to date",
    );
  });

  it("names one scope when the periods do not differ", () => {
    expect(heroSubtitle(snapshot({ kind: "all_time" }))).toBe("Estimated total · All time");
    expect(heroSubtitle(snapshot({ kind: "today" }, [], { mode: "events", events: [] }))).toBe(
      "Estimated total · Today",
    );
  });
});

describe("Dashboard", () => {
  it("shows the combined total and both subtotals, priced or not", () => {
    render(
      <Dashboard
        snapshot={snapshot({ kind: "today" }, [ompEvent()], CURSOR_WITH_USAGE, {
          combined: 2421.775,
          omp: 1200,
          cursor: 1221.775,
        })}
      />,
    );

    expect(screen.getByTestId("estimated-total").textContent).toBe("$24.22");
    expect(screen.getByTestId("omp-subtotal").textContent).toContain("OMP");
    expect(screen.getByTestId("omp-subtotal").textContent).toContain("$12.00");
    expect(screen.getByTestId("cursor-subtotal").textContent).toContain("$12.22");
    expect(screen.getByTestId("hero-subtitle").textContent).toBe(
      "Estimated total · OMP: Today · Cursor: cycle to date",
    );
  });

  it("labels the Cursor row cycle-to-date even on all time", () => {
    render(<Dashboard snapshot={snapshot({ kind: "all_time" }, [], CURSOR_WITH_USAGE)} />);

    expect(screen.getByTestId("cursor-subtotal").textContent).toContain("Cursor (cycle to date)");
    expect(screen.getByTestId("hero-subtitle").textContent).toBe("Estimated total · All time");
  });

  it("shows an em dash per unknown price and $0.00 only for real zeros", () => {
    render(
      <Dashboard
        snapshot={snapshot({ kind: "all_time" }, [], EMPTY_CURSOR, { omp: 0, cursor: null })}
      />,
    );

    expect(screen.getByTestId("estimated-total").textContent).toBe("—");
    expect(screen.getByTestId("omp-subtotal").textContent).toContain("$0.00");
    expect(screen.getByTestId("cursor-subtotal").textContent).toContain("—");
  });

  it("falls back to the priced rows instead of blanking the whole total", () => {
    // One Cursor model has no rate, so the aggregator's combined total is null.
    // The hero must still show what the priced rows come to, marked as a floor.
    const base = snapshot({ kind: "today" }, [ompEvent()], CURSOR_WITH_USAGE, {
      combined: null,
      omp: 1200,
      cursor: null,
    });
    const priced: DashboardSnapshot = {
      ...base,
      models: base.models.map((row) => ({
        ...row,
        estimatedCents: row.source === "omp" ? 1200 : null,
      })),
    };

    render(<Dashboard snapshot={priced} />);

    expect(screen.getByTestId("estimated-total").textContent).toBe("≈$12.00");
    expect(screen.getByTestId("cursor-subtotal").textContent).toContain("—");
    expect(screen.getByTestId("unpriced-note").textContent).toContain("1 model unpriced");
  });

  it("sums the token breakdown across both sources without deduping", () => {
    render(
      <Dashboard snapshot={snapshot({ kind: "all_time" }, [ompEvent()], CURSOR_WITH_USAGE)} />,
    );

    // 900,002 in · 40,105 out · 37,841 cache (OMP read + write, Cursor none).
    expect(screen.getByTestId("token-breakdown").textContent).toBe(
      "Tokens: 900K in · 40.1K out · 37.8K cache",
    );
  });
});
