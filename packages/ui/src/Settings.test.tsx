/**
 * Settings screen tests: sources (OMP + Cursor), pricing (unknown models +
 * bundled rates), and about (db path).
 *
 * The toggles and the path are view state until Save fires; Save and Add price
 * hand values to the host, which is the only thing that touches a database.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CursorSnapshot, DashboardSnapshot, UsageEvent } from "@prompt-burn/core";
import { buildDashboardSnapshot } from "@prompt-burn/core";
import { Settings, type NewPriceInput, type PriceRate } from "./index.js";

afterEach(cleanup);

const EMPTY_CURSOR: CursorSnapshot = {
  mode: "cycle_aggregate",
  cycleStart: "",
  cycleEnd: "",
  models: [],
};

function ompEvent(model: string): UsageEvent {
  return {
    id: `omp:s1:${model}`,
    source: "omp",
    timestamp: "2026-09-02T08:31:31.505Z",
    model,
    rawModel: model,
    tokens: { input: 10, output: 20 },
    sessionId: "s1",
  };
}

function snapshotWith(
  models: Array<{ source: "omp" | "cursor"; model: string; estimatedCents: number | null }>,
  cursorMode: CursorSnapshot["mode"] = "cycle_aggregate",
): DashboardSnapshot {
  const base = buildDashboardSnapshot({
    period: { kind: "all_time" },
    ompEvents: [ompEvent("claude-opus-5")],
    cursor: cursorMode === "events"
      ? { mode: "events", events: [] }
      : EMPTY_CURSOR,
  });
  return {
    ...base,
    cursor: { ...base.cursor, mode: cursorMode },
    models: models.map((m) => ({
      ...m,
      tokens: { input: 100, output: 200 },
    })),
  };
}

describe("Settings", () => {
  it("renders the OMP section with toggle, path override, and health", () => {
    render(<Settings />);

    expect(screen.getByText("Oh My Pi (OMP)")).toBeTruthy();
    const ompToggle = screen.getByRole("checkbox", { name: "Enable OMP" });
    expect((ompToggle as HTMLInputElement).checked).toBe(true);

    const pathInput = screen.getByRole("textbox", { name: "OMP sessions path" }) as HTMLInputElement;
    expect(pathInput.value).toBe("~/.omp/agent/sessions/");
    expect(screen.getByText("Default: ~/.omp/agent/sessions/")).toBeTruthy();
    expect(screen.getByTestId("omp-health").textContent).toBe("Available");
  });

  it("renders custom health detail when provided", () => {
    render(
      <Settings
        health={[{ source: "omp", available: false, detail: "Directory not found" }]}
      />,
    );

    expect(screen.getByTestId("omp-health").textContent).toBe("Directory not found");
  });

  it("renders the Cursor section with Pro status by default, toggle, and crsr_ key field", () => {
    render(<Settings />);

    expect(screen.getByText("Cursor")).toBeTruthy();
    const cursorToggle = screen.getByRole("checkbox", { name: "Enable Cursor" });
    expect((cursorToggle as HTMLInputElement).checked).toBe(true);

    expect(screen.getByTestId("cursor-status").textContent).toContain("Pro");
    expect(screen.getByPlaceholderText("crsr_...")).toBeTruthy();
  });

  it("shows Enterprise status when snapshot cursor mode is events", () => {
    const enterpriseSnapshot = snapshotWith([], "events");
    render(<Settings snapshot={enterpriseSnapshot} />);

    expect(screen.getByTestId("cursor-status").textContent).toBe("Enterprise");
  });

  it("lists unknown models derived from snapshot with Add price buttons", () => {
    const snapshot = snapshotWith([
      { source: "cursor", model: "default", estimatedCents: null },
      { source: "omp", model: "unknown-model-x", estimatedCents: null },
      { source: "omp", model: "claude-opus-5", estimatedCents: 500 },
    ]);

    render(<Settings snapshot={snapshot} />);

    const unknownSection = screen.getByTestId("unknown-models");
    expect(unknownSection.textContent).toContain("default");
    expect(unknownSection.textContent).toContain("unknown-model-x");
    expect(unknownSection.textContent).not.toContain("claude-opus-5");

    expect(screen.getByRole("button", { name: "Add price for default" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add price for unknown-model-x" })).toBeTruthy();
  });

  it("shows 'No unknown models to price' when all models have prices", () => {
    const snapshot = snapshotWith([
      { source: "omp", model: "claude-opus-5", estimatedCents: 500 },
    ]);

    render(<Settings snapshot={snapshot} />);

    expect(screen.getByTestId("no-unknown-models").textContent).toBe("No unknown models to price.");
  });

  it("renders bundled rates table when bundledPrices prop is passed", () => {
    const rates: PriceRate[] = [
      {
        model: "claude-opus-5",
        provider: "anthropic",
        inputPerMtok: 5,
        outputPerMtok: 25,
        cacheReadPerMtok: 0.5,
        cacheWritePerMtok: 6.25,
      },
      {
        model: "qwen3-coder:480b",
        provider: "ollama",
        inputPerMtok: 2,
        outputPerMtok: 4,
        cacheReadPerMtok: null,
        cacheWritePerMtok: null,
      },
    ];

    render(<Settings bundledPrices={rates} />);

    const table = screen.getByTestId("bundled-rates-table");
    expect(table.textContent).toContain("claude-opus-5");
    expect(table.textContent).toContain("$5.00");
    expect(table.textContent).toContain("$25.00");
    expect(table.textContent).toContain("$0.50");
    expect(table.textContent).toContain("$6.25");
    expect(table.textContent).toContain("qwen3-coder:480b");
    expect(table.textContent).toContain("—");
  });

  it("renders the About section with the database path", () => {
    render(<Settings />);

    expect(screen.getByRole("heading", { name: "About", level: 3 })).toBeTruthy();
    expect(screen.getByTestId("db-path").textContent).toBe("~/.prompt-burn/db.sqlite");
    expect(screen.getByText(/SQLite database persists across reinstalls/)).toBeTruthy();
  });

  it("supports in-memory editing of fields and toggles without errors", async () => {
    const user = userEvent.setup();
    render(<Settings />);

    const ompToggle = screen.getByRole("checkbox", { name: "Enable OMP" });
    await user.click(ompToggle);
    expect((ompToggle as HTMLInputElement).checked).toBe(false);

    const pathInput = screen.getByRole("textbox", { name: "OMP sessions path" });
    await user.clear(pathInput);
    await user.type(pathInput, "/custom/omp/path");
    expect((pathInput as HTMLInputElement).value).toBe("/custom/omp/path");

    const keyInput = screen.getByPlaceholderText("crsr_...");
    await user.type(keyInput, "crsr_secret_key");
    expect((keyInput as HTMLInputElement).value).toBe("crsr_secret_key");
  });

  it("hands the edited toggles and path to onSave, not before", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<Settings ompPath="/stored/omp" onSave={onSave} />);

    await user.click(screen.getByRole("checkbox", { name: "Enable Cursor" }));
    const pathInput = screen.getByRole("textbox", { name: "OMP sessions path" });
    await user.clear(pathInput);
    await user.type(pathInput, "/custom/omp/path");
    expect(onSave).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("save-sources"));

    expect(onSave).toHaveBeenCalledWith({
      ompEnabled: true,
      ompPath: "/custom/omp/path",
      cursorEnabled: false,
    });
    expect(screen.getByTestId("save-state").textContent).toContain("Saved");
  });

  it("adds a rate for one unknown model, with blank cache fields left unknown", async () => {
    const user = userEvent.setup();
    const onAddPrice = vi.fn<(price: NewPriceInput) => void>();
    render(
      <Settings
        unknownModels={["default", "gpt-5.6-sol-medium"]}
        onAddPrice={onAddPrice}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add price for default" }));
    await user.type(screen.getByRole("textbox", { name: "Input / 1M" }), "1.25");
    // Output is required: a model priced without it would read as free.
    expect((screen.getByRole("button", { name: "Save price" }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    await user.type(screen.getByRole("textbox", { name: "Output / 1M" }), "5");
    await user.type(screen.getByRole("textbox", { name: "Cache read / 1M" }), "0.125");
    await user.click(screen.getByRole("button", { name: "Save price" }));

    expect(onAddPrice).toHaveBeenCalledWith({
      model: "default",
      provider: "custom",
      inputPerMtok: 1.25,
      outputPerMtok: 5,
      cacheReadPerMtok: 0.125,
      // Left blank: unknown, so those tokens keep the estimate at `—`.
      cacheWritePerMtok: null,
    });
    // The form closes; the other unknown model is untouched.
    expect(screen.queryByTestId("add-price-form")).toBeNull();
    expect(screen.getByRole("button", { name: "Add price for gpt-5.6-sol-medium" })).toBeTruthy();
  });

  it("refuses a rate that is not a number", async () => {
    const user = userEvent.setup();
    const onAddPrice = vi.fn();
    render(<Settings unknownModels={["default"]} onAddPrice={onAddPrice} />);

    await user.click(screen.getByRole("button", { name: "Add price for default" }));
    await user.type(screen.getByRole("textbox", { name: "Input / 1M" }), "free");
    await user.type(screen.getByRole("textbox", { name: "Output / 1M" }), "5");

    expect((screen.getByRole("button", { name: "Save price" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(onAddPrice).not.toHaveBeenCalled();
  });
});
