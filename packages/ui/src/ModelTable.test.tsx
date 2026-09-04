/**
 * The by-model table, built from typed `buildDashboardSnapshot` mocks with
 * prices injected the way the hero tests do.
 *
 * The review focus is row keying: `(source, model)`. The same canonical model
 * used on OMP and on Cursor is two rows, ranked by spend, and an unpriceable
 * row — Cursor's `default` (Auto) — stays visible with `—`, below every row
 * that does price.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CursorSnapshot, DashboardSnapshot, UsageEvent } from "@prompt-burn/core";
import { buildDashboardSnapshot } from "@prompt-burn/core";
import { ModelTable } from "./index.js";

afterEach(cleanup);

/** An OMP assistant line on `model`, timestamped inside the mocked "today". */
function ompEvent(model: string, tokens: UsageEvent["tokens"]): UsageEvent {
  return {
    id: `omp:s1:${model}`,
    source: "omp",
    timestamp: "2026-09-02T08:31:31.505Z",
    model,
    rawModel: model,
    tokens,
    sessionId: "s1",
  };
}

/** Cursor cycle aggregates: the same model as OMP, plus `default` (Auto). */
const CURSOR: CursorSnapshot = {
  mode: "cycle_aggregate",
  cycleStart: "2026-08-15T00:00:00.000Z",
  cycleEnd: "2026-09-15T00:00:00.000Z",
  models: [
    { model: "claude-opus-5", tokens: { input: 420_000, output: 1_100_000 } },
    { model: "default", tokens: { input: 12_000, output: 900 } },
  ],
};

/** Prices keyed `source:model`; anything absent stays an unknown price. */
function snapshot(cents: Record<string, number> = {}): DashboardSnapshot {
  const base = buildDashboardSnapshot({
    period: { kind: "today" },
    ompEvents: [
      ompEvent("claude-opus-5", { input: 2, output: 105, cacheRead: 37_378, cacheWrite: 463 }),
      ompEvent("qwen3-coder:480b", { input: 5_000, output: 2_400, cacheRead: 0, cacheWrite: 0 }),
    ],
    cursor: CURSOR,
    now: new Date("2026-09-02T12:00:00.000Z"),
  });
  return {
    ...base,
    models: base.models.map((row) => ({
      ...row,
      estimatedCents: cents[`${row.source}:${row.model}`] ?? null,
    })),
  };
}

const rowsOf = (table: HTMLElement) =>
  Array.from(table.querySelectorAll("tbody tr")).map((row) =>
    Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent),
  );

describe("ModelTable", () => {
  it("ranks by spend and keeps the same model on both sources as two rows", () => {
    render(<ModelTable rows={snapshot({ "omp:claude-opus-5": 900 }).models} />);
    const rows = rowsOf(screen.getByTestId("model-table"));

    // The priced row leads; the rest fall in by token volume.
    expect(rows.map(([rank, model, source]) => `${rank} ${source} ${model}`)).toEqual([
      "1 OMP claude-opus-5",
      "2 Cursor claude-opus-5",
      "3 Cursor default",
      "4 OMP qwen3-coder:480b",
    ]);
    // Never merged: the shared model appears once per source, not summed.
    expect(screen.getByTestId("model-row-omp-claude-opus-5")).toBeTruthy();
    expect(screen.getByTestId("model-row-cursor-claude-opus-5")).toBeTruthy();
  });

  it("labels each source pill with text, not colour alone", () => {
    render(<ModelTable rows={snapshot().models} />);

    expect(screen.getAllByText("OMP")).toHaveLength(2);
    expect(screen.getAllByText("Cursor")).toHaveLength(2);
  });

  it("shows compact token columns and per-row costs, priced rows first", () => {
    render(
      <ModelTable
        rows={snapshot({ "cursor:claude-opus-5": 1_234.5, "omp:qwen3-coder:480b": 0 }).models}
      />,
    );
    const rows = rowsOf(screen.getByTestId("model-table"));

    expect(rows[0]).toEqual(["1", "claude-opus-5", "Cursor", "420K", "1.1M", "0", "0", "$12.35"]);
    // $0.00 is a real price, so it still outranks every unknown one.
    expect(rows[1]).toEqual(["2", "qwen3-coder:480b", "OMP", "5K", "2.4K", "0", "0", "$0.00"]);
    expect(rows[2]).toEqual([
      "3",
      "claude-opus-5",
      "OMP",
      "2",
      "105",
      "37.4K",
      "463",
      // No price for this model yet: em dash, never $0.
      "—",
    ]);
    expect(rows[3]).toEqual(["4", "default", "Cursor", "12K", "900", "0", "0", "—"]);
  });

  it("keeps the unpriceable default (Auto) row visible with an em dash", () => {
    render(<ModelTable rows={snapshot().models} />);
    const row = screen.getByTestId("model-row-cursor-default");

    expect(row.textContent).toContain("default");
    expect(row.textContent).toContain("12K");
    expect(Array.from(row.querySelectorAll("td")).at(-1)?.textContent).toBe("—");
  });

  it("renders the header structure with no rows and no empty-state copy", () => {
    render(<ModelTable rows={[]} />);
    const table = screen.getByTestId("model-table");

    expect(rowsOf(table)).toEqual([]);
    expect(
      Array.from(table.querySelectorAll("thead th")).map((cell) => cell.textContent),
    ).toEqual(["#", "Model", "Source", "In", "Out", "Cache R", "Cache W", "Est. cost"]);
  });
});
