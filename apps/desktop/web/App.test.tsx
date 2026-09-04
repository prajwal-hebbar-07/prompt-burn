// @vitest-environment jsdom
/**
 * The wiring this commit exists for, driven against a fake sidecar: the window
 * fetches once when it opens, the button fetches again, and neither a fetch in
 * flight nor a failed one is allowed to blank the number.
 *
 * The relay command is mocked, so no Tauri, no child process, no real
 * `~/.prompt-burn` and no real `~/.omp` are involved.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildDashboardSnapshot, type DashboardSnapshot } from "@prompt-burn/core";

const invoke = vi.fn<(command: string, args: { request: string }) => Promise<string>>();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (command: string, args: { request: string }) => invoke(command, args),
}));

const { App } = await import("./App.js");

/** A snapshot as the sidecar would answer, with a visible priced total. */
function snapshotWith(estimatedCents: number | null): DashboardSnapshot {
  return {
    ...buildDashboardSnapshot({
      period: { kind: "all_time" },
      ompEvents: [],
      cursor: { mode: "cycle_aggregate", cycleStart: "", cycleEnd: "", models: [] },
    }),
    estimatedCents,
  };
}

interface FakeSidecar {
  /** Resolves the next fetch; unset means fetch answers immediately. */
  gate?: PromiseWithResolvers<void>;
  fetchOk: boolean;
  snapshot: DashboardSnapshot;
  methods: string[];
}

let sidecar: FakeSidecar;

beforeEach(() => {
  sidecar = { fetchOk: true, snapshot: snapshotWith(2421.775), methods: [] };
  vi.spyOn(console, "error").mockImplementation(() => {});

  invoke.mockImplementation(async (_command, args) => {
    const { id, method } = JSON.parse(args.request) as { id: number; method: string };
    sidecar.methods.push(method);

    if (method === "fetch") {
      await sidecar.gate?.promise;
      const result = sidecar.fetchOk
        ? { at: "2026-09-04T12:00:00.000Z", ok: true, omp: { scannedFiles: 1, skippedFiles: 0, insertedEvents: 3 } }
        : { at: "2026-09-04T12:00:00.000Z", ok: false, error: "sync exploded", omp: { scannedFiles: 0, skippedFiles: 0, insertedEvents: 0 } };
      return JSON.stringify({ type: "response", id, ok: true, result });
    }
    if (method === "getSnapshot") {
      return JSON.stringify({ type: "response", id, ok: true, result: sidecar.snapshot });
    }
    return JSON.stringify({ type: "response", id, ok: false, error: `unknown method ${method}` });
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  invoke.mockReset();
});

const total = () => screen.getByTestId("estimated-total").textContent;
const status = () => screen.getByTestId("fetch-status").textContent;

it("fetches once when the window opens and shows the total", async () => {
  render(<App />);

  // The open fetch starts at once, so the first paint is the never-fetched
  // total with the spinner already up — an em dash, never $0.
  expect(total()).toBe("—");
  expect(status()).toBe("Fetching…");

  await waitFor(() => expect(total()).toBe("$24.22"));
  expect(sidecar.methods).toEqual(["fetch", "getSnapshot"]);
  expect(status()).toContain("Fetched");
});

it("fetches again when Fetch data is clicked, and not otherwise", async () => {
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(total()).toBe("$24.22"));

  sidecar.snapshot = snapshotWith(500);
  await user.click(screen.getByRole("button", { name: "Fetch data" }));

  await waitFor(() => expect(total()).toBe("$5.00"));
  expect(sidecar.methods).toEqual(["fetch", "getSnapshot", "fetch", "getSnapshot"]);

  // No timers: nothing fetches on its own after the click settles.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(sidecar.methods).toHaveLength(4);
});

it("keeps the previous total on screen while a fetch is in flight", async () => {
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(total()).toBe("$24.22"));

  sidecar.gate = Promise.withResolvers<void>();
  sidecar.snapshot = snapshotWith(500);
  await user.click(screen.getByRole("button", { name: "Fetch data" }));

  await waitFor(() => expect(status()).toBe("Fetching…"));
  // The number stays put: no blanking, no $0, no skeleton.
  expect(total()).toBe("$24.22");
  expect(screen.getByTestId("spinner")).toBeTruthy();
  expect((screen.getByRole("button", { name: "Fetch data" }) as HTMLButtonElement).disabled).toBe(true);

  sidecar.gate.resolve();
  await waitFor(() => expect(total()).toBe("$5.00"));
});

it("keeps the last good snapshot when a fetch fails", async () => {
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(total()).toBe("$24.22"));
  const fetchedLabel = status();

  sidecar.fetchOk = false;
  sidecar.snapshot = snapshotWith(500);
  await user.click(screen.getByRole("button", { name: "Fetch data" }));

  await waitFor(() => expect(status()).not.toBe("Fetching…"));
  // Old data survives the failure; the snapshot never advanced to $5.00.
  expect(total()).toBe("$24.22");
  expect(status()).toBe(fetchedLabel);
  expect(sidecar.methods).toEqual(["fetch", "getSnapshot", "fetch"]);
});