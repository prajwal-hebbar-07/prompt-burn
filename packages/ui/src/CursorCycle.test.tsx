/**
 * The wireframe edge states: the Cursor cycle footnote and the two empty
 * bodies.
 *
 * Cursor Pro is cycle-to-date, so the footnote has to name the window and say
 * period filters apply to OMP only — and it may never invent a window the
 * collector has not fetched yet. Never-fetched and fetched-but-empty are
 * separate states, and a fetch in flight never blanks what is on screen.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CursorSnapshot, DashboardSnapshot, PeriodFilter, UsageEvent } from "@prompt-burn/core";
import { buildDashboardSnapshot } from "@prompt-burn/core";
import { Dashboard, emptyStateMessage, formatCycleWindow } from "./index.js";

afterEach(cleanup);

/** The spike's real window: ISO UTC, deliberately not month-aligned. */
const CYCLE: CursorSnapshot = {
  mode: "cycle_aggregate",
  cycleStart: "2026-08-26T07:25:29Z",
  cycleEnd: "2026-09-26T07:25:29Z",
  models: [{ model: "claude-opus-5", tokens: { input: 420_000, output: 1_100_000 } }],
};

/** What the sidecar still ships today: an OMP-only slice, no window. */
const NO_WINDOW: CursorSnapshot = {
  mode: "cycle_aggregate",
  cycleStart: "",
  cycleEnd: "",
  models: [],
};

function ompEvent(): UsageEvent {
  return {
    id: "omp:s1:line1",
    source: "omp",
    timestamp: "2026-09-02T08:31:31.505Z",
    model: "claude-opus-5",
    rawModel: "claude-opus-5",
    tokens: { input: 2, output: 105, cacheRead: 37_378, cacheWrite: 463 },
    sessionId: "s1",
  };
}

interface Options {
  period?: PeriodFilter;
  events?: UsageEvent[];
  cursor?: CursorSnapshot;
  fetch?: DashboardSnapshot["fetch"];
  estimatedCents?: number | null;
}

function snapshot(options: Options = {}): DashboardSnapshot {
  const base = buildDashboardSnapshot({
    period: options.period ?? { kind: "today" },
    ompEvents: options.events ?? [ompEvent()],
    cursor: options.cursor ?? CYCLE,
    now: new Date("2026-09-02T12:00:00.000Z"),
  });
  return {
    ...base,
    estimatedCents: options.estimatedCents ?? null,
    fetch: options.fetch ?? { lastSuccessAt: "2026-09-02T11:59:00.000Z", status: "idle" },
  };
}

describe("formatCycleWindow", () => {
  it("formats a real ISO window and refuses to invent a missing one", () => {
    expect(formatCycleWindow("2026-08-26T07:25:29Z", "2026-09-26T07:25:29Z")).toBe(
      "Aug 26 – Sep 26, 2026",
    );
    expect(formatCycleWindow("2025-12-28T00:00:00Z", "2026-01-28T00:00:00Z")).toBe(
      "Dec 28, 2025 – Jan 28, 2026",
    );
    expect(formatCycleWindow("", "")).toBeNull();
    expect(formatCycleWindow(undefined, undefined)).toBeNull();
    expect(formatCycleWindow("not-a-date", "2026-09-26T07:25:29Z")).toBeNull();
  });
});

describe("the cycle footnote", () => {
  it("names the window and says filters apply to OMP only when scopes differ", () => {
    render(<Dashboard snapshot={snapshot({ period: { kind: "today" } })} />);

    expect(screen.getByTestId("cycle-footnote").textContent).toBe(
      "Cursor shows cycle to date (Aug 26 – Sep 26, 2026) · period filters apply to OMP only",
    );
  });

  it("keeps the window on all time, where the periods do not clash", () => {
    render(<Dashboard snapshot={snapshot({ period: { kind: "all_time" } })} />);

    expect(screen.getByTestId("cycle-footnote").textContent).toBe(
      "Cursor shows cycle to date (Aug 26 – Sep 26, 2026)",
    );
  });

  it("omits the range when the collector has no window yet", () => {
    render(<Dashboard snapshot={snapshot({ cursor: NO_WINDOW })} />);

    expect(screen.getByTestId("cycle-footnote").textContent).toBe(
      "Cursor shows cycle to date · period filters apply to OMP only",
    );
  });

  it("shows nothing for an Enterprise events snapshot", () => {
    render(<Dashboard snapshot={snapshot({ cursor: { mode: "events", events: [] } })} />);

    expect(screen.queryByTestId("cycle-footnote")).toBeNull();
  });
});

describe("the empty bodies", () => {
  const NEVER: DashboardSnapshot["fetch"] = { lastSuccessAt: null, status: "idle" };

  it("does not claim an empty period before the first successful fetch", () => {
    render(<Dashboard snapshot={snapshot({ events: [], cursor: NO_WINDOW, fetch: NEVER })} />);

    expect(screen.getByTestId("empty-state").textContent).toBe("No usage data yet");
    // Never `$0.00` for an unknown price.
    expect(screen.getByTestId("estimated-total").textContent).toBe("—");
    expect(screen.queryByTestId("model-table")).toBeNull();
  });

  it("uses product's sentence once a fetch succeeded with no usage", () => {
    render(
      <Dashboard
        snapshot={snapshot({ events: [], cursor: NO_WINDOW, estimatedCents: 0 })}
      />,
    );

    expect(screen.getByTestId("empty-state").textContent).toBe(
      "No OMP or Cursor usage for this period",
    );
    expect(screen.getByTestId("estimated-total").textContent).toBe("$0.00");
  });

  it("keeps the previous numbers and rows while a fetch is in flight", () => {
    render(
      <Dashboard
        snapshot={snapshot({
          estimatedCents: 2421.775,
          fetch: { lastSuccessAt: "2026-09-02T11:00:00.000Z", status: "fetching" },
        })}
      />,
    );

    expect(screen.getByTestId("estimated-total").textContent).toBe("$24.22");
    expect(screen.getByTestId("model-table")).toBeTruthy();
    expect(screen.queryByTestId("empty-state")).toBeNull();
  });

  it("keeps the never-fetched body while the first fetch is still running", () => {
    expect(
      emptyStateMessage(
        snapshot({
          events: [],
          cursor: NO_WINDOW,
          fetch: { lastSuccessAt: null, status: "fetching" },
        }),
      ),
    ).toBe("No usage data yet");
  });
});
