/**
 * The failed-fetch banner: its copy, and that it never costs the screen its
 * numbers. `fetchErrorMessage` inputs are shaped like the passes both shells
 * actually receive from `@prompt-burn/reader`.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DashboardSnapshot } from "@prompt-burn/core";
import { buildDashboardSnapshot } from "@prompt-burn/core";
import { AppShell, fetchErrorMessage } from "./index.js";

afterEach(cleanup);

/** A priced snapshot with the fetch state under test — data always present. */
function snapshot(fetch: DashboardSnapshot["fetch"]): DashboardSnapshot {
  const base = buildDashboardSnapshot({
    period: { kind: "all_time" },
    ompEvents: [],
    cursor: { mode: "cycle_aggregate", cycleStart: "", cycleEnd: "", models: [] },
  });
  return { ...base, estimatedCents: 2421.775, fetch };
}

describe("fetchErrorMessage", () => {
  it("names the failed source and the one that still worked", () => {
    expect(
      fetchErrorMessage({
        omp: { ok: true },
        cursor: { ok: false },
        error: "Cursor failed: cursor.com said 503",
      }),
    ).toBe("Cursor failed · OMP OK — cursor.com said 503");

    expect(
      fetchErrorMessage({
        omp: { ok: false },
        cursor: { ok: true },
        error: "OMP failed: sync exploded",
      }),
    ).toBe("OMP failed · Cursor OK — sync exploded");
  });

  it("claims nothing OK when both sources failed", () => {
    expect(
      fetchErrorMessage({
        omp: { ok: false },
        cursor: { ok: false },
        error: "OMP failed: sync exploded · Cursor failed: cursor.com said 503",
      }),
    ).toBe("OMP failed · Cursor failed — sync exploded · cursor.com said 503");
  });

  it("leaves a degraded Cursor unnamed: not installed is not a failure", () => {
    // The reader reports `cursor.ok: false` with a local reason and writes no
    // Cursor line, so the banner must not accuse it of failing.
    expect(
      fetchErrorMessage({
        omp: { ok: false },
        cursor: { ok: false },
        error: "OMP failed: sync exploded",
      }),
    ).toBe("OMP failed — sync exploded");
  });

  it("falls back to Fetch failed when no source ever reported", () => {
    expect(fetchErrorMessage({ error: "the sidecar refused" })).toBe(
      "Fetch failed — the sidecar refused",
    );
    expect(fetchErrorMessage({})).toBe("Fetch failed");
  });
});

describe("the banner in the shell", () => {
  it("shows the message and Retry while the numbers stay on screen", async () => {
    const onFetch = vi.fn();
    const user = userEvent.setup();
    render(
      <AppShell
        snapshot={snapshot({
          lastSuccessAt: "2026-09-04T11:57:00Z",
          status: "error",
          error: "Cursor failed · OMP OK — cursor.com said 503",
        })}
        onFetch={onFetch}
        now={() => new Date("2026-09-04T12:00:00Z")}
      />,
    );

    expect(screen.getByTestId("fetch-error-message").textContent).toContain(
      "Cursor failed · OMP OK — cursor.com said 503",
    );
    // Kept data: never blanked, never $0, and the last success still labelled.
    expect(screen.getByTestId("estimated-total").textContent).toBe("$24.22");
    expect(screen.getByTestId("fetch-status").textContent).toBe("Fetched 3 min ago");

    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onFetch).toHaveBeenCalledTimes(1);
  });

  it("stays visible on Settings, where the same failure applies", async () => {
    const user = userEvent.setup();
    render(
      <AppShell snapshot={snapshot({ lastSuccessAt: null, status: "error", error: "Fetch failed" })} />,
    );

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByTestId("fetch-error")).toBeTruthy();
  });

  it("steps aside for the spinner while a retry is in flight", () => {
    render(
      <AppShell
        snapshot={snapshot({
          lastSuccessAt: "2026-09-04T11:57:00Z",
          status: "fetching",
          error: "Cursor failed · OMP OK — cursor.com said 503",
        })}
      />,
    );

    expect(screen.queryByTestId("fetch-error")).toBeNull();
    expect(screen.getByTestId("spinner")).toBeTruthy();
    // The retry never clears what is on screen.
    expect(screen.getByTestId("estimated-total").textContent).toBe("$24.22");
  });

  it("shows nothing on a clean pass", () => {
    render(<AppShell snapshot={snapshot({ lastSuccessAt: "2026-09-04T11:57:00Z", status: "idle" })} />);
    expect(screen.queryByTestId("fetch-error")).toBeNull();
  });
});
