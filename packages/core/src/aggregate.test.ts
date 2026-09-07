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

  it("flags a cycle-wide Cursor everywhere except all-time, and labels the cycle", () => {
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

  it("leaves every cost null without a pricer, and defaults fetch state to idle", () => {
    expect(today.estimatedCents).toBeNull();
    expect(today.omp.estimatedCents).toBeNull();
    expect(today.cursor.estimatedCents).toBeNull();
    expect(today.fetch).toEqual({ lastSuccessAt: null, status: "idle" });
    expect(today.period).toEqual({ kind: "today" });
  });
});

describe("buildDashboardSnapshot with an injected pricer", () => {
  /** A cent per input token for `claude-opus-5`; every other model unpriced. */
  const priceCents = (model: string, tokens: { input: number }, timestamp: string) =>
    model === "claude-opus-5" && timestamp !== "" ? tokens.input : null;

  const today = buildDashboardSnapshot({
    period: { kind: "today" },
    ompEvents: OMP_EVENTS,
    cursor: { ...CURSOR_CYCLE, models: [] },
    now: NOW,
    priceCents,
  });

  it("sums the priced rows and prices each event at its own timestamp", () => {
    // Today's two opus events, 5 + 7 input tokens; yesterday's 1000 is filtered.
    const opus = today.models.find((row) => row.model === "claude-opus-5");
    expect(opus?.estimatedCents).toBe(12);
  });

  it("keeps a total null when any row it contains is unpriced", () => {
    // `glm-5.3-flash` is in the same period and has no rate.
    expect(today.models.find((row) => row.model === "glm-5.3-flash")?.estimatedCents).toBeNull();
    expect(today.omp.estimatedCents).toBeNull();
    expect(today.estimatedCents).toBeNull();
  });

  it("prices a source whose every row is known, even beside an unpriced one", () => {
    const opusOnly = buildDashboardSnapshot({
      period: { kind: "today" },
      ompEvents: OMP_EVENTS.filter((event) => event.model === "claude-opus-5"),
      cursor: CURSOR_CYCLE,
      now: NOW,
      priceCents,
    });

    expect(opusOnly.omp.estimatedCents).toBe(12);
    // The Cursor cycle models have no rate here, and the cycle is the wrong
    // scope for "today" anyway: it is out of the combined figure, so its
    // unknown price no longer blanks a number it is not part of.
    expect(opusOnly.cursor.estimatedCents).toBeNull();
    expect(opusOnly.estimatedCents).toBe(12);
  });

  it("still lets an unpriced row inside the period blank the total", () => {
    const allTime = buildDashboardSnapshot({
      period: { kind: "all_time" },
      ompEvents: OMP_EVENTS.filter((event) => event.model === "claude-opus-5"),
      cursor: CURSOR_CYCLE,
      now: NOW,
      priceCents,
    });

    // All-time counts the cycle, so the cycle's unpriced rows count too.
    expect(allTime.mixedPeriod).toBe(false);
    expect(allTime.estimatedCents).toBeNull();
  });

  it("reports zero, not unknown, for a period with no usage at all", () => {
    const empty = buildDashboardSnapshot({
      period: { kind: "today" },
      ompEvents: [],
      cursor: { ...CURSOR_CYCLE, models: [] },
      now: NOW,
      priceCents,
    });

    expect(empty.estimatedCents).toBe(0);
  });
});

describe("buildDashboardSnapshot with a Cursor window", () => {
  /** A cent per input token for `claude-opus-5`, whatever the timestamp. */
  const priceCents = (model: string, tokens: { input: number }) =>
    model === "claude-opus-5" ? tokens.input : null;

  /** What Cursor answers when asked for today rather than the cycle. */
  const WINDOW = { start: ist("2026-09-02T00:00:00.000"), end: ist("2026-09-02T18:00:00.000") };
  const windowed = buildDashboardSnapshot({
    period: { kind: "today" },
    ompEvents: OMP_EVENTS.filter((event) => event.model === "claude-opus-5"),
    cursor: {
      ...CURSOR_CYCLE,
      window: WINDOW,
      models: [{ model: "claude-opus-5", tokens: { input: 20, output: 5 } }],
    },
    now: NOW,
    priceCents,
  });

  it("counts Cursor in the total once its rows cover the period", () => {
    expect(windowed.mixedPeriod).toBe(false);
    expect(windowed.cursor.window).toEqual(WINDOW);
    // Today's two opus events (5 + 7) plus Cursor's 20 for the same day.
    expect(windowed.omp.estimatedCents).toBe(12);
    expect(windowed.cursor.estimatedCents).toBe(20);
    expect(windowed.estimatedCents).toBe(32);
  });

  it("drops the cycle label, since the rows are no longer the cycle", () => {
    expect(windowed.cursor.cycleLabel).toBeUndefined();
    // The cycle window still travels, for the footnote that names it.
    expect(windowed.cursor.cycleStart).toBe("2026-08-26T07:25:29Z");
    expect(windowed.cursor.cycleEnd).toBe("2026-09-26T07:25:29Z");
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
    expect(snapshot.cursor.cycleStart).toBeUndefined();
    expect(snapshot.cursor.cycleEnd).toBeUndefined();
    expect(snapshot.cursor.mode).toBe("events");
  });

  it("carries the Pro cycle window for labelling, unchanged by the period", () => {
    // The window is the collector's, verbatim: it never bounds the rollup and
    // is never month-aligned.
    for (const period of [{ kind: "today" }, { kind: "all_time" }] as const) {
      const snapshot = buildDashboardSnapshot({
        period,
        ompEvents: [],
        cursor: CURSOR_CYCLE,
        now: NOW,
      });
      expect(snapshot.cursor.cycleStart).toBe(CURSOR_CYCLE.cycleStart);
      expect(snapshot.cursor.cycleEnd).toBe(CURSOR_CYCLE.cycleEnd);
    }
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

describe("buildDashboardSnapshot per-project rollups", () => {
  const api = { ...ompEvent("2026-09-02T09:00:00.000", "claude-opus-5", 5, 50), project: "/w/api" };
  const apiAgain = {
    ...ompEvent("2026-09-02T09:30:00.000", "glm-5.3-flash", 1, 10),
    project: "/w/api",
  };
  const web = { ...ompEvent("2026-09-02T10:00:00.000", "glm-5.3-flash", 7, 70), project: "/w/web" };
  // A headerless transcript: real usage, no directory to attribute it to.
  const unattributed = ompEvent("2026-09-02T11:00:00.000", "claude-opus-5", 9, 90);
  const events = [web, api, apiAgain, unattributed];

  /** One cent per output token, so ranking is predictable and OMP-only. */
  const priceCents = (_model: string, tokens: { output: number }) => tokens.output;

  it("groups each project's models and buckets the unattributed usage", () => {
    const snapshot = buildDashboardSnapshot({
      period: { kind: "today" },
      ompEvents: events,
      cursor: CURSOR_CYCLE,
      now: NOW,
      priceCents,
    });

    // Cost descending: unattributed 90c, /w/web 70c, /w/api 50c + 10c.
    expect(snapshot.projects.map((p) => [p.project, p.estimatedCents])).toEqual([
      [null, 90],
      ["/w/web", 70],
      ["/w/api", 60],
    ]);

    const apiUsage = snapshot.projects.find((p) => p.project === "/w/api");
    // Both models of that project, and only that project's tokens.
    expect(apiUsage?.models.map((row) => [row.source, row.model])).toEqual([
      ["omp", "claude-opus-5"],
      ["omp", "glm-5.3-flash"],
    ]);
    expect(apiUsage?.tokens).toEqual({ input: 6, output: 60, cacheRead: 200, cacheWrite: 20 });

    // Cursor is never a project row: its cycle carries no directory.
    expect(snapshot.projects.some((p) => p.models.some((row) => row.source === "cursor"))).toBe(
      false,
    );
    // …and the combined view is untouched by the breakdown.
    expect(snapshot.omp.tokens.output).toBe(220);
    expect(snapshot.cursor.tokens.input).toBe(CURSOR_CYCLE.models[0]!.tokens.input + 3_200_000);
  });

  it("takes the same period as everything else on screen", () => {
    const yesterday = {
      ...ompEvent("2026-09-01T09:00:00.000", "claude-opus-5", 3, 3),
      project: "/w/old",
    };
    const today = buildDashboardSnapshot({
      period: { kind: "today" },
      ompEvents: [...events, yesterday],
      cursor: CURSOR_CYCLE,
      now: NOW,
    });
    const allTime = buildDashboardSnapshot({
      period: { kind: "all_time" },
      ompEvents: [...events, yesterday],
      cursor: CURSOR_CYCLE,
      now: NOW,
    });

    expect(today.projects.map((p) => p.project)).not.toContain("/w/old");
    expect(allTime.projects.map((p) => p.project)).toContain("/w/old");
  });

  it("sinks a project holding an unpriced model below every priced one", () => {
    const snapshot = buildDashboardSnapshot({
      period: { kind: "today" },
      ompEvents: [api, web],
      cursor: CURSOR_CYCLE,
      now: NOW,
      // /w/web's only model has no rate at all.
      priceCents: (model, tokens) => (model === "glm-5.3-flash" ? null : tokens.output),
    });

    expect(snapshot.projects.map((p) => [p.project, p.estimatedCents])).toEqual([
      ["/w/api", 50],
      ["/w/web", null],
    ]);
  });
});
