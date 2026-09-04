/**
 * The host's two commands, against a stub reader: `fetch` runs the collector
 * pass and `getSnapshot` does not. No editor, no database — `respond` is the
 * seam `extension.ts` hands its messages to.
 */

import type { DashboardSnapshot, PeriodFilter } from "@prompt-burn/core";
import type { FetchResult, UsageReader } from "@prompt-burn/reader";
import { expect, it, vi } from "vitest";
import { respond } from "./host-messages.js";

const FETCHED = { at: "2026-09-04T10:00:00.000Z", ok: true } as FetchResult;

function stubReader() {
  return {
    discover: vi.fn(async () => []),
    fetch: vi.fn(async () => FETCHED),
    getSnapshot: vi.fn(async (period: PeriodFilter) => ({ period }) as DashboardSnapshot),
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
