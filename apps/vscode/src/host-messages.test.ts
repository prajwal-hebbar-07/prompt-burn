/**
 * The host's commands, against a stub reader: `fetch` runs the collector pass,
 * `getSnapshot` does not, and the settings commands write through to the
 * reader. No editor, no database — `respond` is the seam `extension.ts` hands
 * its messages to.
 */

import type { DashboardSnapshot, PeriodFilter } from "@prompt-burn/core";
import type { AppSettings, FetchResult, UsageReader } from "@prompt-burn/reader";
import { expect, it, vi } from "vitest";
import { respond } from "./host-messages.js";

const FETCHED = { at: "2026-09-04T10:00:00.000Z", ok: true } as FetchResult;
const STORED: AppSettings = {
  ompEnabled: true,
  ompPath: "/tmp/omp-sessions",
  cursorEnabled: false,
};

function stubReader() {
  return {
    discover: vi.fn(async () => []),
    fetch: vi.fn(async () => FETCHED),
    getSnapshot: vi.fn(async (period: PeriodFilter) => ({ period }) as DashboardSnapshot),
    getSettings: vi.fn(async () => STORED),
    saveSettings: vi.fn(async (_patch: Partial<AppSettings>) => {}),
    addPrice: vi.fn(async () => {}),
  } satisfies UsageReader;
}

it("answers a fetch with the collector pass result", async () => {
  const reader = stubReader();

  expect(await respond(reader, { id: 1, method: "fetch" })).toEqual({
    id: 1,
    ok: true,
    result: FETCHED,
  });
  expect(reader.getSnapshot).not.toHaveBeenCalled();
});

it("answers a snapshot request for the given period without fetching", async () => {
  const reader = stubReader();
  const period: PeriodFilter = { kind: "today" };

  expect(await respond(reader, { id: 7, method: "getSnapshot", period })).toEqual({
    id: 7,
    ok: true,
    result: { period },
  });
  expect(reader.fetch).not.toHaveBeenCalled();
});

it("turns a failed read and an unknown method into answers, not throws", async () => {
  const reader = stubReader();
  reader.getSnapshot.mockRejectedValueOnce(new Error("database is locked"));

  expect(
    await respond(reader, { id: 2, method: "getSnapshot", period: { kind: "all_time" } }),
  ).toEqual({ id: 2, ok: false, error: "database is locked" });
  expect(await respond(reader, { id: 3, method: "wat" })).toEqual({
    id: 3,
    ok: false,
    error: "unknown method wat",
  });
});

it("persists settings and answers with what is now stored", async () => {
  const reader = stubReader();
  const settings = { ompPath: "/tmp/omp-sessions", cursorEnabled: false };

  expect(await respond(reader, { id: 4, method: "saveSettings", settings })).toEqual({
    id: 4,
    ok: true,
    result: STORED,
  });
  expect(reader.saveSettings).toHaveBeenCalledWith(settings);
  expect(await respond(reader, { id: 5, method: "getSettings" })).toEqual({
    id: 5,
    ok: true,
    result: STORED,
  });
});

it("inserts a price without fetching or aggregating", async () => {
  const reader = stubReader();
  const price = {
    model: "cursor-grok-4.6-high",
    provider: "custom",
    inputPerMtok: 3,
    outputPerMtok: 15,
    cacheReadPerMtok: null,
    cacheWritePerMtok: null,
  };

  expect(await respond(reader, { id: 6, method: "addPrice", price })).toEqual({
    id: 6,
    ok: true,
    result: null,
  });
  expect(reader.addPrice).toHaveBeenCalledWith(price);
  expect(reader.fetch).not.toHaveBeenCalled();
  expect(reader.getSnapshot).not.toHaveBeenCalled();
});
