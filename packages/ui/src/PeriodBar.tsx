/**
 * The Dashboard period bar: Today · This month · All time · Date range.
 *
 * One control covers both a single day and a span. Date range opens a popover
 * with Start / End fields over a single calendar; the end day is inclusive and
 * `start === end` is that one day. Dates are `YYYY-MM-DD` wall-clock dates in
 * the device timezone — the period math itself lives in `@prompt-burn/core`
 * (`periodBounds`), which turns the inclusive end into the next local midnight.
 *
 * Props only: choosing a period calls `onPeriodChange`. Loading the snapshot
 * for it is the host's job, and it is not a fetch.
 */

import { useState } from "react";
import type { PeriodFilter } from "@prompt-burn/core";
import { formatDateSpan } from "./format.js";

/** Local wall-clock date as `YYYY-MM-DD` — `toISOString` would be UTC. */
function isoDate(at: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** `YYYY-MM-DD` as local midnight, matching core's `localMidnight`. */
function fromIsoDate(date: string): Date {
  const [year, month, day] = date.split("-");
  return new Date(Number(year), Number(month) - 1, Number(day));
}

const DAY_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const MONTH_YEAR = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

/** `Aug 1 – Aug 15, 2026`, or a single `Aug 1, 2026` when start equals end. */
export function formatRangeLabel(start: string, end: string): string {
  return formatDateSpan(fromIsoDate(start), fromIsoDate(end));
}

/** Every day of `month`, as local ISO dates. Length resolves leap years. */
function monthDays(month: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(month.getFullYear(), month.getMonth(), 1);
  while (cursor.getMonth() === month.getMonth()) {
    days.push(isoDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

/** The control names, reused by the hero subtitle so the two never drift. */
const PERIOD_LABELS: Record<PeriodFilter["kind"], string> = {
  today: "Today",
  this_month: "This month",
  all_time: "All time",
  range: "Date range",
};

/** `Today`, `This month`, `All time` or `Date range`. */
export function periodLabel(period: PeriodFilter): string {
  return PERIOD_LABELS[period.kind];
}

const FIXED_SEGMENTS: ReadonlyArray<{ label: string; period: PeriodFilter }> = [
  { label: PERIOD_LABELS.today, period: { kind: "today" } },
  { label: PERIOD_LABELS.this_month, period: { kind: "this_month" } },
  { label: PERIOD_LABELS.all_time, period: { kind: "all_time" } },
];

function segmentClass(active: boolean): string {
  return `rounded-control px-3 py-1.5 text-small font-medium ${
    active
      ? "bg-brand-subtle text-brand ring-1 ring-brand"
      : "text-foreground-secondary hover:text-foreground"
  }`;
}

interface Draft {
  start: string | null;
  /** `null` means "start only" — applying makes it a single day. */
  end: string | null;
}

export interface PeriodBarProps {
  /** The period the host currently has selected. */
  period: PeriodFilter;
  onPeriodChange?: (period: PeriodFilter) => void;
  /** Injectable clock for the month the calendar opens on. */
  now?: () => Date;
}

export function PeriodBar({ period, onPeriodChange, now }: PeriodBarProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() =>
    period.kind === "range"
      ? { start: period.start, end: period.end }
      : { start: null, end: null },
  );
  const [month, setMonth] = useState(() => {
    const anchor = period.kind === "range" ? fromIsoDate(period.start) : (now ? now() : new Date());
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  });

  // A fresh click starts a new range; a later day closes it, an earlier one
  // becomes the new start. Clicking the same day twice is a single day.
  const pickDay = (date: string) =>
    setDraft((current) =>
      current.start === null || current.end !== null || date < current.start
        ? { start: date, end: null }
        : { start: current.start, end: date },
    );

  const apply = () => {
    if (draft.start === null) return;
    const end = draft.end ?? draft.start;
    setDraft({ start: draft.start, end });
    onPeriodChange?.({ kind: "range", start: draft.start, end });
    setOpen(false);
  };

  const selected = draft.end ?? draft.start;

  return (
    <div className="relative">
      <div
        role="group"
        aria-label="Period"
        className="flex flex-wrap items-center gap-2 rounded-control"
      >
        {FIXED_SEGMENTS.map(({ label, period: next }) => (
          <button
            key={label}
            type="button"
            aria-pressed={period.kind === next.kind}
            onClick={() => {
              setOpen(false);
              onPeriodChange?.(next);
            }}
            className={segmentClass(period.kind === next.kind)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          aria-pressed={period.kind === "range"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className={segmentClass(period.kind === "range")}
        >
          {PERIOD_LABELS.range}
        </button>
        {period.kind === "range" ? (
          <span
            data-testid="period-chip"
            className="rounded-full bg-brand-subtle px-3 py-1 text-small text-brand ring-1 ring-brand"
          >
            {formatRangeLabel(period.start, period.end)} · inclusive end day
          </span>
        ) : null}
      </div>

      {open ? (
        <div
          role="dialog"
          aria-label="Date range"
          className="absolute z-10 mt-2 w-80 rounded-popover border border-border bg-surface p-4 shadow-lg"
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
              className="rounded-control px-2 text-foreground-secondary"
            >
              ‹
            </button>
            <span className="text-small font-medium">{MONTH_YEAR.format(month)}</span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
              className="rounded-control px-2 text-foreground-secondary"
            >
              ›
            </button>
          </div>

          <div className="mt-3 flex gap-2">
            {(["start", "end"] as const).map((field) => (
              <label key={field} className="flex-1 text-small text-foreground-secondary">
                {field === "start" ? "Start" : "End"}
                <input
                  type="date"
                  aria-label={field === "start" ? "Start date" : "End date"}
                  value={draft[field] ?? ""}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, [field]: event.target.value || null }))
                  }
                  className="mt-1 w-full rounded-control border border-border px-2 py-1 text-small text-foreground"
                />
              </label>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((day, index) => (
              <span key={index} className="text-table text-foreground-muted">
                {day}
              </span>
            ))}
            {Array.from({ length: month.getDay() }, (_, index) => (
              <span key={`pad-${index}`} />
            ))}
            {monthDays(month).map((date) => {
              const edge = date === draft.start || date === selected;
              const between = draft.start !== null && selected !== null && date > draft.start && date < selected;
              return (
                <button
                  key={date}
                  type="button"
                  aria-label={DAY_YEAR.format(fromIsoDate(date))}
                  aria-pressed={edge}
                  onClick={() => pickDay(date)}
                  className={`rounded-control py-1 text-small ${
                    edge
                      ? "bg-brand font-medium text-surface"
                      : between
                        ? "bg-brand-subtle text-brand"
                        : "text-foreground-secondary"
                  }`}
                >
                  {Number(date.slice(8))}
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-table leading-table text-foreground-muted">
            Inclusive end day · single-day = same start and end
          </p>

          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setDraft({ start: null, end: null })}
              className="rounded-control px-3 py-1.5 text-small font-medium text-foreground-secondary"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={apply}
              disabled={draft.start === null}
              className="rounded-control border border-brand bg-brand-subtle px-3 py-1.5 text-small font-medium text-brand disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
