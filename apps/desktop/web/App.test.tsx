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
import {
  buildDashboardSnapshot,
  type DashboardSnapshot,
  type PeriodFilter,
} from "@prompt-burn/core";

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
  /** OMP succeeds while Cursor fails — the partial-success case. */
  cursorFails?: boolean;
  snapshot: DashboardSnapshot;
  methods: string[];
  /** The `period` every `getSnapshot` was asked for, in order. */
  periods: PeriodFilter[];
}

let sidecar: FakeSidecar;

beforeEach(() => {
  sidecar = { fetchOk: true, snapshot: snapshotWith(2421.775), methods: [], periods: [] };
  vi.spyOn(console, "error").mockImplementation(() => {});

  invoke.mockImplementation(async (_command, args) => {
    const { id, method, period } = JSON.parse(args.request) as {
      id: number;
      method: string;
      period?: PeriodFilter;
    };
    sidecar.methods.push(method);

    if (method === "fetch") {
      await sidecar.gate?.promise;
      const at = "2026-09-04T12:00:00.000Z";
      const cursor = sidecar.cursorFails
        ? { ok: false, reason: "fetch_failed", error: "cursor.com said 503", models: 0 }
        : { ok: true, models: 6 };
      const result = sidecar.fetchOk
        ? {
            at,
            ok: !sidecar.cursorFails,
            ...(sidecar.cursorFails ? { error: "Cursor failed: cursor.com said 503" } : {}),
            omp: { ok: true, scannedFiles: 1, skippedFiles: 0, insertedEvents: 3 },
            cursor,
          }
        : {
            at,
            ok: false,
            error: "sync exploded",
            omp: { ok: false, error: "sync exploded", scannedFiles: 0, skippedFiles: 0, insertedEvents: 0 },
            cursor: { ok: false, reason: "not_installed", error: "no state", models: 0 },
          };
      return JSON.stringify({ type: "response", id, ok: true, result });
    }
    if (method === "getSnapshot") {
      if (period) sidecar.periods.push(period);
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

it("applies the successful source when only one of the two fails", async () => {
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(total()).toBe("$24.22"));

  sidecar.cursorFails = true;
  sidecar.snapshot = snapshotWith(500);
  await user.click(screen.getByRole("button", { name: "Fetch data" }));

  // OMP's new rows land even though Cursor failed; the failure only sets the
  // fetch status (the banner that reads it is commit 29).
  await waitFor(() => expect(total()).toBe("$5.00"));
  expect(sidecar.methods).toEqual(["fetch", "getSnapshot", "fetch", "getSnapshot"]);
  expect(console.error).toHaveBeenCalledWith(
    "prompt-burn: partial fetch",
    "Cursor failed: cursor.com said 503",
  );
});

it("opens on this month and re-reads the snapshot for a new period, without fetching", async () => {
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(total()).toBe("$24.22"));
  expect(sidecar.periods).toEqual([{ kind: "this_month" }]);
  const fetchedLabel = status();

  sidecar.snapshot = snapshotWith(500);
  await user.click(screen.getByRole("button", { name: "Today" }));

  await waitFor(() => expect(total()).toBe("$5.00"));
  // A period change re-aggregates: one more getSnapshot, no second fetch, and
  // the fetch bookkeeping (and so the status label) is untouched.
  expect(sidecar.methods).toEqual(["fetch", "getSnapshot", "getSnapshot"]);
  expect(sidecar.periods).toEqual([{ kind: "this_month" }, { kind: "today" }]);
  expect(status()).toBe(fetchedLabel);
  expect(screen.queryByTestId("spinner")).toBeNull();
});

it("sends an applied date range as inclusive local dates", async () => {
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(total()).toBe("$24.22"));

  // The calendar opens on the current month; the 1st is always in it.
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const iso = `${firstOfMonth.getFullYear()}-${String(firstOfMonth.getMonth() + 1).padStart(2, "0")}-01`;
  const dayLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(firstOfMonth);

  await user.click(screen.getByRole("button", { name: "Date range" }));
  await user.click(screen.getByRole("button", { name: dayLabel }));
  await user.click(screen.getByRole("button", { name: "Apply" }));

  // One clicked day is a single inclusive day, dated in the device timezone.
  await waitFor(() => expect(sidecar.periods.at(-1)).toEqual({ kind: "range", start: iso, end: iso }));
  expect(screen.getByTestId("period-chip").textContent).toContain(dayLabel);
  expect(sidecar.methods.filter((method) => method === "fetch")).toHaveLength(1);
});

it("navigates to Settings without calling fetch or writing sidecar state", async () => {
  const user = userEvent.setup();
  render(<App />);
  await waitFor(() => expect(total()).toBe("$24.22"));
  const methodsBefore = [...sidecar.methods];

  await user.click(screen.getByRole("button", { name: "Settings" }));

  expect(screen.getByRole("heading", { name: "Settings", level: 2 })).toBeTruthy();
  expect(screen.getByText("Oh My Pi (OMP)")).toBeTruthy();
  expect(screen.getByText("Cursor")).toBeTruthy();
  expect(screen.getByTestId("db-path").textContent).toBe("~/.prompt-burn/db.sqlite");
  expect(screen.queryByRole("group", { name: "Period" })).toBeNull();
  expect(screen.queryByTestId("estimated-total")).toBeNull();

  // Navigating to Settings is pure view state: no extra fetch, no write side-effects.
  expect(sidecar.methods).toEqual(methodsBefore);
});