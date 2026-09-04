/**
 * Period filter boundaries in IST (UTC+5:30, no DST) — the timezone the plan
 * names because its offset is half-hourly, so a UTC-midnight bug cannot pass
 * by accident. `vitest.config.ts` pins TZ; the first test fails loudly if not.
 *
 * Event timestamps are UTC, as OMP writes them. The IST wall time each one
 * stands for is in the comment beside it.
 */

import { describe, expect, it } from "vitest";
import { filterEventsByPeriod } from "./period.js";
import type { UsageEvent } from "./index.js";

function event(timestamp: string): UsageEvent {
  return {
    id: timestamp,
    source: "omp",
    timestamp,
    model: "claude-sonnet-4-5",
    rawModel: "claude-sonnet-4-5",
    tokens: { input: 10, output: 20 },
  };
}

/** IST wall clock -> the UTC instant a source would have recorded. */
function ist(wallClock: string): string {
  return new Date(`${wallClock}+05:30`).toISOString();
}

const kept = (events: UsageEvent[]) => events.map((e) => e.timestamp);

describe("timezone setup", () => {
  it("runs in IST, not UTC wearing an IST label", () => {
    // Node's ICU may echo the Asia/Calcutta alias back for Asia/Kolkata.
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toMatch(/^Asia\/(Kolkata|Calcutta)$/);
    // Local midnight on Jan 1 is 18:30 UTC the day before — the +05:30 proof.
    expect(new Date(2027, 0, 1).toISOString()).toBe("2026-12-31T18:30:00.000Z");
  });
});

describe("this_month", () => {
  const now = new Date(2026, 8, 15, 10, 0); // 15 Sep 2026, 10:00 IST

  it("splits on local midnight of the 1st, not UTC midnight", () => {
    const events = [
      event(ist("2026-08-31T23:59:59.999")),
      event(ist("2026-09-01T00:00:00.000")),
      event(ist("2026-09-15T12:00:00.000")),
      event(ist("2026-09-30T23:59:59.999")),
      event(ist("2026-10-01T00:00:00.000")),
    ];

    expect(kept(filterEventsByPeriod(events, { kind: "this_month" }, now))).toEqual([
      ist("2026-09-01T00:00:00.000"),
      ist("2026-09-15T12:00:00.000"),
      ist("2026-09-30T23:59:59.999"),
    ]);
  });

  it("excludes 31 Dec IST and keeps the first moment of January", () => {
    const january = new Date(2027, 0, 20, 9, 0); // 20 Jan 2027 IST
    const events = [
      event(ist("2026-12-31T23:59:59.999")),
      event(ist("2027-01-01T00:00:00.000")),
      event(ist("2027-01-31T23:59:59.999")),
      event(ist("2027-02-01T00:00:00.000")),
    ];

    expect(kept(filterEventsByPeriod(events, { kind: "this_month" }, january))).toEqual([
      ist("2027-01-01T00:00:00.000"),
      ist("2027-01-31T23:59:59.999"),
    ]);
  });
});

describe("today", () => {
  it("spans one local midnight to the next", () => {
    const now = new Date(2026, 8, 2, 14, 30); // 2 Sep 2026, 14:30 IST
    const events = [
      event(ist("2026-09-01T23:59:59.999")),
      event(ist("2026-09-02T00:00:00.000")),
      event(ist("2026-09-02T23:59:59.999")),
      event(ist("2026-09-03T00:00:00.000")),
    ];

    expect(kept(filterEventsByPeriod(events, { kind: "today" }, now))).toEqual([
      ist("2026-09-02T00:00:00.000"),
      ist("2026-09-02T23:59:59.999"),
    ]);
  });

  it("rolls to the new year on 1 Jan IST", () => {
    const now = new Date(2027, 0, 1, 0, 30); // 1 Jan 2027, 00:30 IST
    const events = [
      event(ist("2026-12-31T23:59:59.999")),
      event(ist("2027-01-01T00:00:00.000")),
      event(ist("2027-01-01T00:29:00.000")),
    ];

    expect(kept(filterEventsByPeriod(events, { kind: "today" }, now))).toEqual([
      ist("2027-01-01T00:00:00.000"),
      ist("2027-01-01T00:29:00.000"),
    ]);
  });
});

describe("range", () => {
  const events = [
    event(ist("2026-09-01T23:59:59.999")),
    event(ist("2026-09-02T00:00:00.000")),
    event(ist("2026-09-02T23:59:59.999")),
    event(ist("2026-09-03T00:00:00.000")),
    event(ist("2026-09-04T23:59:59.999")),
    event(ist("2026-09-05T00:00:00.000")),
  ];

  it("treats start === end as that one local day", () => {
    const filtered = filterEventsByPeriod(events, {
      kind: "range",
      start: "2026-09-02",
      end: "2026-09-02",
    });

    expect(kept(filtered)).toEqual([
      ist("2026-09-02T00:00:00.000"),
      ist("2026-09-02T23:59:59.999"),
    ]);
  });

  it("includes the whole inclusive end day and stops at the next midnight", () => {
    const filtered = filterEventsByPeriod(events, {
      kind: "range",
      start: "2026-09-02",
      end: "2026-09-04",
    });

    expect(kept(filtered)).toEqual([
      ist("2026-09-02T00:00:00.000"),
      ist("2026-09-02T23:59:59.999"),
      ist("2026-09-03T00:00:00.000"),
      ist("2026-09-04T23:59:59.999"),
    ]);
  });

  it("rejects dates that are not YYYY-MM-DD", () => {
    expect(() =>
      filterEventsByPeriod(events, { kind: "range", start: "02-09-2026", end: "2026-09-02" }),
    ).toThrow(RangeError);
  });
});

describe("all_time", () => {
  it("keeps every event regardless of date", () => {
    const events = [
      event(ist("2019-01-01T00:00:00.000")),
      event(ist("2026-09-02T14:01:31.505")),
      event(ist("2099-12-31T23:59:59.999")),
    ];

    expect(filterEventsByPeriod(events, { kind: "all_time" })).toEqual(events);
  });
});
