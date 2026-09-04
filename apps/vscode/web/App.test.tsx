// @vitest-environment jsdom
/**
 * The wiring this commit exists for, driven against a fake extension host: the
 * tab fetches once when it opens, again only when the user asks, and never
 * blanks the number while a fetch is in flight or after one fails. A period
 * change re-reads the snapshot and fetches nothing.
 *
 * The host is faked at the `postMessage` boundary — the real `web/host.ts`
 * plumbing runs, including the request ids — so nothing here needs an editor.
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import {
  buildDashboardSnapshot,
  type DashboardSnapshot,
  type PeriodFilter,
} from "@prompt-burn/core";
import type { NewPriceInput, SourceSettings } from "@prompt-burn/ui";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

/** A snapshot as the host would answer, with a visible priced total. */
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

interface FakeHost {
  /** Resolves the next fetch; unset means fetch answers immediately. */
  gate?: PromiseWithResolvers<void>;
  fetchOk: boolean;
  snapshot: DashboardSnapshot;
  methods: string[];
  /** The `period` every `getSnapshot` was asked for, in order. */
  periods: PeriodFilter[];
  /** What the host has persisted, as the database would hold it. */
  settings: SourceSettings;
  /** Every `price_entries` row the tab asked for, in order. */
  prices: NewPriceInput[];
}

let host: FakeHost;

/** The webview bridge the editor injects; answers arrive as window messages. */
const postMessage = vi.fn((message: unknown) => {
  const { id, method, period, settings, price } = message as {
    id: number;
    method: string;
    period?: PeriodFilter;
    settings?: Partial<SourceSettings>;
    price?: NewPriceInput;
  };
  host.methods.push(method);

  void (async () => {
    if (method === "fetch") {
      await host.gate?.promise;
      const at = "2026-09-04T12:00:00.000Z";
      const result = host.fetchOk
        ? { at, ok: true, omp: { ok: true }, cursor: { ok: true } }
        : {
            at,
            ok: false,
            // The reader's wording: both sources really failed here.
            error: "OMP failed: sync exploded · Cursor failed: cursor.com said 503",
            omp: { ok: false },
            cursor: { ok: false },
          };
      answer({ id, ok: true, result });
      return;
    }
    if (method === "getSnapshot") {
      if (period) host.periods.push(period);
      answer({ id, ok: true, result: host.snapshot });
      return;
    }
    if (method === "getSettings") {
      answer({ id, ok: true, result: host.settings });
      return;
    }
    if (method === "saveSettings") {
      host.settings = { ...host.settings, ...settings };
      answer({ id, ok: true, result: host.settings });
      return;
    }
    if (method === "addPrice") {
      if (price) host.prices.push(price);
      answer({ id, ok: true, result: null });
      return;
    }
    answer({ id, ok: false, error: `unknown method ${method}` });
  })();
});

function answer(response: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data: response }));
}

Object.assign(globalThis, { acquireVsCodeApi: () => ({ postMessage }) });
// Dynamic on purpose: `web/host.ts` calls `acquireVsCodeApi()` at module load,
// so the bridge stub above has to exist before this module is evaluated.
const { App } = await import("./App.js");

beforeEach(() => {
  host = {
    fetchOk: true,
    snapshot: snapshotWith(2421.775),
    methods: [],
    periods: [],
    settings: { ompEnabled: true, ompPath: "~/.omp/agent/sessions/", cursorEnabled: true },
    prices: [],
  };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  postMessage.mockClear();
});

const total = () => screen.getByTestId("estimated-total").textContent;

it("fetches once when the tab opens and shows the total", async () => {
  render(<App />);

  await waitFor(() => expect(total()).toBe("$24.22"));
  expect(host.methods).toEqual(["fetch", "getSettings", "getSnapshot"]);
  // Fetch-on-open uses the default period, "This month".
  expect(host.periods).toEqual([{ kind: "this_month" }]);
});

it("fetches again when Fetch data is clicked, and not otherwise", async () => {
  render(<App />);
  await waitFor(() => expect(total()).toBe("$24.22"));

  host.snapshot = snapshotWith(3000);
  await userEvent.click(screen.getByRole("button", { name: /fetch data/i }));

  await waitFor(() => expect(total()).toBe("$30.00"));
  expect(host.methods).toEqual(["fetch", "getSettings", "getSnapshot", "fetch", "getSnapshot"]);
});

it("keeps the previous total on screen while a fetch is in flight", async () => {
  render(<App />);
  await waitFor(() => expect(total()).toBe("$24.22"));

  host.gate = Promise.withResolvers<void>();
  host.snapshot = snapshotWith(9999);
  await userEvent.click(screen.getByRole("button", { name: /fetch data/i }));

  await waitFor(() => expect(screen.getByTestId("spinner")).toBeTruthy());
  expect(total()).toBe("$24.22");

  host.gate.resolve();
  await waitFor(() => expect(total()).toBe("$99.99"));
});

it("keeps the last good snapshot when a fetch fails", async () => {
  render(<App />);
  await waitFor(() => expect(total()).toBe("$24.22"));

  host.fetchOk = false;
  host.snapshot = snapshotWith(null);
  await userEvent.click(screen.getByRole("button", { name: /fetch data/i }));

  await waitFor(() => expect(screen.queryByTestId("spinner")).toBeNull());
  expect(total()).toBe("$24.22");
  // The same banner the desktop window shows, from the same UI package.
  expect(screen.getByTestId("fetch-error-message").textContent).toContain(
    "OMP failed · Cursor failed — sync exploded · cursor.com said 503",
  );
  // The failed pass read nothing back: no snapshot request followed it.
  expect(host.methods).toEqual(["fetch", "getSettings", "getSnapshot", "fetch"]);
});

it("re-reads the snapshot for a new period without fetching", async () => {
  render(<App />);
  await waitFor(() => expect(total()).toBe("$24.22"));

  await userEvent.click(screen.getByRole("button", { name: /^today$/i }));

  await waitFor(() => expect(host.periods).toEqual([{ kind: "this_month" }, { kind: "today" }]));
  expect(host.methods).toEqual(["fetch", "getSettings", "getSnapshot", "getSnapshot"]);
});

it("saves the source settings the tab loaded, over the same channel", async () => {
  host.settings = { ompEnabled: true, ompPath: "/stored/omp", cursorEnabled: true };
  render(<App />);
  await waitFor(() => expect(host.methods).toContain("getSettings"));

  await userEvent.click(screen.getByRole("button", { name: /^settings$/i }));
  expect((screen.getByRole("textbox", { name: "OMP sessions path" }) as HTMLInputElement).value).toBe(
    "/stored/omp",
  );

  await userEvent.click(screen.getByRole("checkbox", { name: "Enable Cursor" }));
  await userEvent.click(screen.getByTestId("save-sources"));

  await waitFor(() =>
    expect(host.settings).toEqual({
      ompEnabled: true,
      ompPath: "/stored/omp",
      cursorEnabled: false,
    }),
  );
  // Same database file as the desktop window; the tab only sends the values.
  expect(host.prices).toEqual([]);
});
