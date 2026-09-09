/**
 * The hero totals card, rendered from typed `DashboardSnapshot` mocks — the
 * same view model `buildDashboardSnapshot` produces. The review focus is the
 * copy and the arithmetic when scopes differ: a Cursor cycle standing against
 * a narrower period must be named as the cycle, kept out of the hero number,
 * and say so — while a Cursor that answered for the period is just counted.
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

/** The same usage, but Cursor answered for the period rather than the cycle. */
const CURSOR_WINDOWED: CursorSnapshot = {
  ...CURSOR_WITH_USAGE,
  window: { start: "2026-09-01T18:30:00.000Z", end: "2026-09-02T12:00:00.000Z" },
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

/** One Claude Code transcript event, on the same model as OMP's. */
function claudeEvent(): UsageEvent {
  return {
    ...ompEvent(),
    id: "claude:s9:line1",
    source: "claude-code",
    tokens: { input: 1_000, output: 500, cacheRead: 2_000, cacheWrite: 159 },
  };
}

interface Costs {
  combined?: number | null;
  omp?: number | null;
  claudeCode?: number | null;
  cursor?: number | null;
}

/** A snapshot straight from the real aggregator, with prices injected. */
function snapshot(
  period: PeriodFilter = { kind: "all_time" },
  events: UsageEvent[] = [],
  cursor: CursorSnapshot = EMPTY_CURSOR,
  costs: Costs = {},
  claudeEvents: UsageEvent[] = [],
): DashboardSnapshot {
  const base = buildDashboardSnapshot({
    period,
    ompEvents: events,
    claudeEvents,
    cursor,
    now: new Date("2026-09-02T12:00:00.000Z"),
  });
  return {
    ...base,
    estimatedCents: costs.combined ?? null,
    omp: { ...base.omp, estimatedCents: costs.omp ?? null },
    claudeCode: { ...base.claudeCode, estimatedCents: costs.claudeCode ?? null },
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
  it("names both scopes, and which one the number is, when Cursor cannot follow", () => {
    expect(heroSubtitle(snapshot({ kind: "today" }))).toBe(
      "Estimated total · OMP + Claude Code: Today · Cursor: cycle to date (not in total)",
    );
    expect(heroSubtitle(snapshot({ kind: "this_month" }))).toBe(
      "Estimated total · OMP + Claude Code: This month · Cursor: cycle to date (not in total)",
    );
    expect(heroSubtitle(snapshot({ kind: "range", start: "2026-08-01", end: "2026-08-15" }))).toBe(
      "Estimated total · OMP + Claude Code: Date range · Cursor: cycle to date (not in total)",
    );
  });

  it("names one scope when the periods do not differ", () => {
    expect(heroSubtitle(snapshot({ kind: "all_time" }))).toBe("Estimated total · All time");
    expect(heroSubtitle(snapshot({ kind: "today" }, [], { mode: "events", events: [] }))).toBe(
      "Estimated total · Today",
    );
    // Cursor answered for the day itself: one scope, one number.
    expect(heroSubtitle(snapshot({ kind: "today" }, [], CURSOR_WINDOWED))).toBe(
      "Estimated total · Today",
    );
  });
});

describe("Dashboard", () => {
  it("shows the combined total and all three subtotals, priced or not", () => {
    render(
      <Dashboard
        snapshot={snapshot(
          { kind: "today" },
          [ompEvent()],
          CURSOR_WINDOWED,
          { combined: 2721.775, omp: 1200, claudeCode: 300, cursor: 1221.775 },
          [claudeEvent()],
        )}
      />,
    );

    expect(screen.getByTestId("estimated-total").textContent).toBe("$27.22");
    expect(screen.getByTestId("omp-subtotal").textContent).toContain("OMP");
    expect(screen.getByTestId("omp-subtotal").textContent).toContain("$12.00");
    // Its own row, never folded into OMP's even on the same model.
    expect(screen.getByTestId("claude-code-subtotal").textContent).toBe("Claude Code$3.00");
    // Cursor answered for the day, so it is plain "Cursor" and it is counted.
    expect(screen.getByTestId("cursor-subtotal").textContent).toContain("Cursor$12.22");
    expect(screen.getByTestId("hero-subtitle").textContent).toBe("Estimated total · Today");
  });

  it("drops a switched-off source from the card instead of showing it as $0", () => {
    const base = snapshot({ kind: "today" }, [ompEvent()], CURSOR_WINDOWED, {
      combined: 1200,
      omp: 1200,
      cursor: 1221.775,
    });
    render(
      <Dashboard snapshot={{ ...base, enabled: { ...base.enabled, "claude-code": false } }} />,
    );

    expect(screen.queryByTestId("claude-code-subtotal")).toBeNull();
    // The sources still on are untouched.
    expect(screen.getByTestId("omp-subtotal").textContent).toContain("$12.00");
    expect(screen.getByTestId("cursor-subtotal")).not.toBeNull();
  });

  it("names only the switched-on scopes in a mixed-period subtitle", () => {
    const base = snapshot({ kind: "today" }, [ompEvent()], CURSOR_WITH_USAGE, { omp: 1200 });
    expect(heroSubtitle(base)).toBe(
      "Estimated total · OMP + Claude Code: Today · Cursor: cycle to date (not in total)",
    );
    expect(heroSubtitle({ ...base, enabled: { ...base.enabled, "claude-code": false } })).toBe(
      "Estimated total · OMP: Today · Cursor: cycle to date (not in total)",
    );
  });

  it("keeps a cycle-only Cursor out of the hero and says so on its row", () => {
    render(
      <Dashboard
        snapshot={snapshot({ kind: "today" }, [ompEvent()], CURSOR_WITH_USAGE, {
          // What the aggregator produces for this shape: OMP alone.
          combined: 1200,
          omp: 1200,
          cursor: 1221.775,
        })}
      />,
    );

    expect(screen.getByTestId("estimated-total").textContent).toBe("$12.00");
    expect(screen.getByTestId("cursor-subtotal").textContent).toContain(
      "Cursor (cycle to date · not in total)",
    );
    // The cycle number is still on screen — it is just not part of the day.
    expect(screen.getByTestId("cursor-subtotal").textContent).toContain("$12.22");
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
    // All-time, because that is the period a Cursor cycle belongs to.
    const base = snapshot({ kind: "all_time" }, [ompEvent()], CURSOR_WITH_USAGE, {
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

  it("ignores an unpriced Cursor cycle that is not in the total anyway", () => {
    const base = snapshot({ kind: "today" }, [ompEvent()], CURSOR_WITH_USAGE, {
      combined: 1200,
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

    // Exact, not a floor: the unpriced row is outside the number.
    expect(screen.getByTestId("estimated-total").textContent).toBe("$12.00");
    expect(screen.queryByTestId("unpriced-note")).toBeNull();
  });

  it("floors the hero on both timestamped sources, not OMP alone", () => {
    // Cursor's cycle is out of the day, so the fallback covers OMP and Claude
    // Code together: $12.00 here would mean Claude Code was dropped from it.
    const base = snapshot(
      { kind: "today" },
      [ompEvent()],
      CURSOR_WITH_USAGE,
      { combined: null, omp: 1200, claudeCode: 300 },
      [claudeEvent()],
    );
    const priced: DashboardSnapshot = {
      ...base,
      models: base.models.map((row) => ({
        ...row,
        estimatedCents: row.source === "omp" ? 1200 : row.source === "claude-code" ? 300 : null,
      })),
    };

    render(<Dashboard snapshot={priced} />);

    expect(screen.getByTestId("estimated-total").textContent).toBe("≈$15.00");
    // The unpriced rows are Cursor's, outside the number the note qualifies.
    expect(screen.queryByTestId("unpriced-note")).toBeNull();
  });

  it("sums the token breakdown across all three sources without deduping", () => {
    render(
      <Dashboard
        snapshot={snapshot({ kind: "all_time" }, [ompEvent()], CURSOR_WITH_USAGE, {}, [
          claudeEvent(),
        ])}
      />,
    );

    // 901,002 in · 40,605 out · 40,000 cache across OMP, Claude Code and Cursor.
    expect(screen.getByTestId("token-breakdown").textContent).toBe(
      "Tokens: 901K in · 40.6K out · 40K cache",
    );
  });
});
