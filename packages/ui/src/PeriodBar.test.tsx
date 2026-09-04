/**
 * The period bar and its one date-range control. Every segment has to produce
 * the `PeriodFilter` core already understands, and the range popover has to
 * treat the end day as inclusive — `start === end` is a single day.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PeriodFilter } from "@prompt-burn/core";
import { PeriodBar, formatRangeLabel } from "./index.js";

afterEach(cleanup);

/** August 2026 is the calendar the popover opens on in these tests. */
const AUGUST = () => new Date(2026, 7, 20, 9, 30);

const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

describe("formatRangeLabel", () => {
  it("collapses a same-year span and names a single day once", () => {
    expect(formatRangeLabel("2026-08-01", "2026-08-15")).toBe("Aug 1 – Aug 15, 2026");
    expect(formatRangeLabel("2026-08-01", "2026-08-01")).toBe("Aug 1, 2026");
    expect(formatRangeLabel("2025-12-30", "2026-01-02")).toBe("Dec 30, 2025 – Jan 2, 2026");
  });
});

describe("the fixed segments", () => {
  it("emits the matching filter for Today, This month and All time", async () => {
    const onPeriodChange = vi.fn<(period: PeriodFilter) => void>();
    const user = userEvent.setup();
    render(
      <PeriodBar period={{ kind: "this_month" }} onPeriodChange={onPeriodChange} now={AUGUST} />,
    );

    await user.click(button("Today"));
    await user.click(button("All time"));
    await user.click(button("This month"));

    expect(onPeriodChange.mock.calls.map(([period]) => period)).toEqual([
      { kind: "today" },
      { kind: "all_time" },
      { kind: "this_month" },
    ]);
  });

  it("marks the selected segment and shows no range chip", () => {
    render(<PeriodBar period={{ kind: "today" }} now={AUGUST} />);

    expect(button("Today").getAttribute("aria-pressed")).toBe("true");
    expect(button("This month").getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByTestId("period-chip")).toBeNull();
  });
});

describe("the date range control", () => {
  it("applies a multi-day span with an inclusive end", async () => {
    const onPeriodChange = vi.fn<(period: PeriodFilter) => void>();
    const user = userEvent.setup();
    render(
      <PeriodBar period={{ kind: "this_month" }} onPeriodChange={onPeriodChange} now={AUGUST} />,
    );

    await user.click(button("Date range"));
    expect(screen.getByRole("dialog", { name: "Date range" })).toBeTruthy();

    await user.click(button("Aug 1, 2026"));
    await user.click(button("Aug 15, 2026"));
    await user.click(button("Apply"));

    expect(onPeriodChange).toHaveBeenCalledWith({
      kind: "range",
      start: "2026-08-01",
      end: "2026-08-15",
    });
    // Applying closes the one control.
    expect(screen.queryByRole("dialog", { name: "Date range" })).toBeNull();
  });

  it("treats one clicked day as a single day: same start and end", async () => {
    const onPeriodChange = vi.fn<(period: PeriodFilter) => void>();
    const user = userEvent.setup();
    render(
      <PeriodBar period={{ kind: "all_time" }} onPeriodChange={onPeriodChange} now={AUGUST} />,
    );

    await user.click(button("Date range"));
    await user.click(button("Aug 7, 2026"));
    await user.click(button("Apply"));

    expect(onPeriodChange).toHaveBeenCalledWith({
      kind: "range",
      start: "2026-08-07",
      end: "2026-08-07",
    });
  });

  it("restarts the span when an earlier day is clicked", async () => {
    const onPeriodChange = vi.fn<(period: PeriodFilter) => void>();
    const user = userEvent.setup();
    render(
      <PeriodBar period={{ kind: "all_time" }} onPeriodChange={onPeriodChange} now={AUGUST} />,
    );

    await user.click(button("Date range"));
    await user.click(button("Aug 15, 2026"));
    await user.click(button("Aug 3, 2026"));
    await user.click(button("Aug 9, 2026"));
    await user.click(button("Apply"));

    expect(onPeriodChange).toHaveBeenCalledWith({
      kind: "range",
      start: "2026-08-03",
      end: "2026-08-09",
    });
  });

  it("clears the draft and disables Apply until a day is picked again", async () => {
    const onPeriodChange = vi.fn<(period: PeriodFilter) => void>();
    const user = userEvent.setup();
    render(
      <PeriodBar period={{ kind: "all_time" }} onPeriodChange={onPeriodChange} now={AUGUST} />,
    );

    await user.click(button("Date range"));
    await user.click(button("Aug 4, 2026"));
    await user.click(button("Clear"));

    expect(button("Apply").disabled).toBe(true);
    expect((screen.getByLabelText("Start date") as HTMLInputElement).value).toBe("");
    await user.click(button("Apply"));
    expect(onPeriodChange).not.toHaveBeenCalled();
  });

  it("shows the applied range as a chip with the inclusive-end note", () => {
    render(
      <PeriodBar period={{ kind: "range", start: "2026-08-01", end: "2026-08-15" }} now={AUGUST} />,
    );

    const chip = screen.getByTestId("period-chip");
    expect(chip.textContent).toContain("Aug 1 – Aug 15, 2026");
    expect(chip.textContent).toContain("inclusive end day");
    expect(button("Date range").getAttribute("aria-pressed")).toBe("true");
  });

  it("opens on the month of an already-applied range, with its fields filled", async () => {
    const user = userEvent.setup();
    render(
      <PeriodBar period={{ kind: "range", start: "2026-03-02", end: "2026-03-04" }} now={AUGUST} />,
    );

    await user.click(button("Date range"));

    expect(screen.getByText("March 2026")).toBeTruthy();
    expect((screen.getByLabelText("Start date") as HTMLInputElement).value).toBe("2026-03-02");
    expect((screen.getByLabelText("End date") as HTMLInputElement).value).toBe("2026-03-04");
  });
});
