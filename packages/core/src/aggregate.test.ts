/**
 * Tests run in IST (pinned in `vitest.config.ts`), so "today" means a local
 * day. Timestamps below are the UTC instants OMP would have written.
 */

import { describe, expect, it } from "vitest";
import { buildDashboardSnapshot, CURSOR_CYCLE_LABEL } from "./aggregate.js";
import type { CursorSnapshot, UsageEvent } from "./index.js";

/** IST wall clock -> the UTC instant a source would have recorded. */
function ist(wallClock: string): string {
  return new Date(`${wallClock}+05:30`).toISOString();
}

function ompEvent(wallClock: string, model: string, input: number, output: number): UsageEvent {
  return {
    id: `${model}@${wallClock}`,
    source: "omp",
    timestamp: ist(wallClock),
    model,
    rawModel: model,
    tokens: { input, output, cacheRead: 100, cacheWrite: 10 },
  };
}

const NOW = new Date(2026, 8, 2, 18, 0); // 2 Sep 2026, 18:00 IST

const OMP_EVENTS = [
  ompEvent("2026-09-01T12:00:00.000", "claude-opus-5", 1000, 200), // yesterday
  ompEvent("2026-09-02T09:00:00.000", "claude-opus-5", 5, 50),
  ompEvent("2026-09-02T17:00:00.000", "claude-opus-5", 7, 70),
  ompEvent("2026-09-02T17:30:00.000", "glm-5.3-flash", 3, 30),
];

/** Shaped after `docs/fixtures/cursor-cycle-aggregates.json`. */
const CURSOR_CYCLE: CursorSnapshot = {
  mode: "cycle_aggregate",
  cycleStart: "2026-08-26T07:25:29Z",
  cycleEnd: "2026-09-26T07:25:29Z",
  models: [
    // Same canonical model as OMP above — must stay a separate row.
    { model: "claude-opus-5", tokens: { input: 164, output: 82300, cacheRead: 7350000 } },
    // Auto: real tokens, no public rate. Never dropped.
    { model: "default", tokens: { input: 3200000, output: 219000, cacheRead: 16700000 } },
  ],
};

describe("buildDashboardSnapshot with Cursor Pro cycle aggregates", () => {
  const today = buildDashboardSnapshot({
    period: { kind: "today" },
    ompEvents: OMP_EVENTS,
    cursor: CURSOR_CYCLE,
    now: NOW,
  });
  const allTime = buildDashboardSnapshot({
    period: { kind: "all_time" },
    ompEvents: OMP_EVENTS,
    cursor: CURSOR_CYCLE,
    now: NOW,
  });

  it("filters OMP by the period and leaves the Cursor cycle untouched", () => {
    // Today: the three 2 Sep events, not the 1 Sep one.
    expect(today.omp.tokens).toEqual({ input: 15, output: 150, cacheRead: 300, cacheWrite: 30 });
    expect(allTime.omp.tokens).toEqual({
      input: 1015,
      output: 350,
      cacheRead: 400,
      cacheWrite: 40,
    });
    // Cursor is cycle-to-date under both periods — identical, never shrunk.
    expect(today.cursor.tokens).toEqual(allTime.cursor.tokens);
    expect(today.cursor.tokens).toEqual({
      input: 3200164,
      output: 301300,
      cacheRead: 24050000,
      cacheWrite: 0,
    });
  });

  it("combines the two subtotals without dedupe", () => {
    expect(today.omp.tokens.input + today.cursor.tokens.input).toBe(3200179);
  });

  it("flags mixed periods everywhere except all-time, and always labels the cycle", () => {
    expect(today.mixedPeriod).toBe(true);
    expect(allTime.mixedPeriod).toBe(false);
    expect(today.cursor.cycleLabel).toBe(CURSOR_CYCLE_LABEL);
    expect(allTime.cursor.cycleLabel).toBe(CURSOR_CYCLE_LABEL);
    expect(today.cursor.mode).toBe("cycle_aggregate");

    for (const period of [
      { kind: "this_month" },
      { kind: "range", start: "2026-09-02", end: "2026-09-02" },
    ] as const) {
      const snapshot = buildDashboardSnapshot({
        period,
        ompEvents: OMP_EVENTS,
        cursor: CURSOR_CYCLE,
        now: NOW,
      });
      expect(snapshot.mixedPeriod).toBe(true);
    }
  });

  it("keys rows on (source, model), so a shared model is two rows", () => {
    expect(today.models).toEqual([
      {
        source: "omp",
        model: "claude-opus-5",
        tokens: { input: 12, output: 120, cacheRead: 200, cacheWrite: 20 },
        estimatedCents: null,
      },
      {
        source: "omp",
        model: "glm-5.3-flash",
        tokens: { input: 3, output: 30, cacheRead: 100, cacheWrite: 10 },
        estimatedCents: null,
      },
      {
        source: "cursor",
        model: "claude-opus-5",
        tokens: { input: 164, output: 82300, cacheRead: 7350000, cacheWrite: 0 },
        estimatedCents: null,
      },
      {
        source: "cursor",
        model: "default",
        tokens: { input: 3200000, output: 219000, cacheRead: 16700000, cacheWrite: 0 },
        estimatedCents: null,
      },
    ]);
  });

  it("leaves every cost null and defaults fetch state to idle", () => {
    expect(today.estimatedCents).toBeNull();
    expect(today.omp.estimatedCents).toBeNull();
    expect(today.cursor.estimatedCents).toBeNull();
    expect(today.fetch).toEqual({ lastSuccessAt: null, status: "idle" });
    expect(today.period).toEqual({ kind: "today" });
  });
});

describe("buildDashboardSnapshot edge cases", () => {
  it("reports zeros and no rows when there is no usage", () => {
    const empty = buildDashboardSnapshot({
      period: { kind: "today" },
      ompEvents: [],
      cursor: { ...CURSOR_CYCLE, models: [] },
      now: NOW,
    });

    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    expect(empty.omp.tokens).toEqual(zero);
    expect(empty.cursor.tokens).toEqual(zero);
    expect(empty.models).toEqual([]);
    // Still mixed: Cursor's scope is the cycle even when it reported nothing.
    expect(empty.mixedPeriod).toBe(true);
  });

  it("filters Cursor Enterprise events like OMP, with no cycle label", () => {
    const cursorEvents: CursorSnapshot = {
      mode: "events",
      events: [
        { ...ompEvent("2026-09-01T12:00:00.000", "claude-opus-5", 9, 9), source: "cursor" },
        { ...ompEvent("2026-09-02T12:00:00.000", "claude-opus-5", 4, 40), source: "cursor" },
      ],
    };
    const snapshot = buildDashboardSnapshot({
      period: { kind: "today" },
      ompEvents: [],
      cursor: cursorEvents,
      now: NOW,
    });

    expect(snapshot.cursor.tokens).toEqual({
      input: 4,
      output: 40,
      cacheRead: 100,
      cacheWrite: 10,
    });
    expect(snapshot.mixedPeriod).toBe(false);
    expect(snapshot.cursor.cycleLabel).toBeUndefined();
    expect(snapshot.cursor.mode).toBe("events");
  });

  it("passes the shell's fetch state through", () => {
    const snapshot = buildDashboardSnapshot({
      period: { kind: "all_time" },
      ompEvents: [],
      cursor: CURSOR_CYCLE,
      fetch: { lastSuccessAt: "2026-09-02T08:31:31.505Z", status: "error", error: "401" },
    });

    expect(snapshot.fetch).toEqual({
      lastSuccessAt: "2026-09-02T08:31:31.505Z",
      status: "error",
      error: "401",
    });
  });
});
