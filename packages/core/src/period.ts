/**
 * Calendar period filtering for timestamped events, in the device timezone.
 *
 * Bounds are local midnight, never UTC midnight: `Date(y, m, d)` builds the
 * local wall-clock instant, and rolling a field past its end (`d + 1`,
 * `m + 1`) lets the runtime resolve month length, leap years and DST.
 *
 * Cursor Pro cycle aggregates carry no timestamps and are not filtered here.
 */

import type { PeriodFilter, UsageEvent } from "./index.js";

/** Half-open `[start, end)` in epoch ms. `null` means unbounded. */
interface Bounds {
  start: number | null;
  end: number | null;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses `YYYY-MM-DD` as local midnight. `new Date(str)` would be UTC. */
function localMidnight(isoDate: string, dayOffset = 0): number {
  const match = ISO_DATE.exec(isoDate);
  if (!match) throw new RangeError(`Expected a YYYY-MM-DD date, got "${isoDate}"`);
  const [, year, month, day] = match;
  const at = new Date(Number(year), Number(month) - 1, Number(day) + dayOffset);
  if (Number.isNaN(at.getTime())) throw new RangeError(`Invalid date "${isoDate}"`);
  return at.getTime();
}

/**
 * Half-open bounds for a period. `now` is injectable so `today` and
 * `this_month` are testable; it defaults to the wall clock.
 */
export function periodBounds(period: PeriodFilter, now: Date = new Date()): Bounds {
  switch (period.kind) {
    case "all_time":
      return { start: null, end: null };
    case "today": {
      const y = now.getFullYear();
      const m = now.getMonth();
      const d = now.getDate();
      return { start: new Date(y, m, d).getTime(), end: new Date(y, m, d + 1).getTime() };
    }
    case "this_month": {
      const y = now.getFullYear();
      const m = now.getMonth();
      return { start: new Date(y, m, 1).getTime(), end: new Date(y, m + 1, 1).getTime() };
    }
    case "range":
      // UI end day is inclusive; in code that is the next local midnight.
      return { start: localMidnight(period.start), end: localMidnight(period.end, 1) };
  }
}

/**
 * Keeps the events whose `timestamp` falls in `period`: start inclusive, end
 * exclusive. Unparsable timestamps survive only `all_time`.
 */
export function filterEventsByPeriod(
  events: readonly UsageEvent[],
  period: PeriodFilter,
  now: Date = new Date(),
): UsageEvent[] {
  const { start, end } = periodBounds(period, now);
  if (start === null && end === null) return [...events];
  return events.filter((event) => {
    const at = Date.parse(event.timestamp);
    if (Number.isNaN(at)) return false;
    return (start === null || at >= start) && (end === null || at < end);
  });
}
