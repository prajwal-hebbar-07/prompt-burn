/**
 * The host's half of the webview protocol, kept out of `extension.ts` so it is
 * testable without a running editor: one request in, one response out, no
 * `vscode` import.
 *
 * Five commands. `fetch` runs the collectors and answers with the pass result;
 * `getSnapshot` re-aggregates what is already stored for one period, so a
 * period change costs no I/O beyond the database; `getSettings` /
 * `saveSettings` carry the source toggles and the OMP path override, and
 * `addPrice` inserts one `price_entries` row so the next `getSnapshot`
 * re-prices history. `id` pairs answers with requests, because `postMessage` is
 * one shared channel and two requests can overlap.
 *
 * Errors are answers here — the reader's `fetch` never throws, and a malformed
 * request or a failed `getSnapshot` comes back as `ok: false` instead of
 * killing the message handler.
 */

import type { PeriodFilter } from "@prompt-burn/core";
import type { AppSettings, NewPriceEntry, UsageReader } from "@prompt-burn/reader";

export type HostRequest =
  | { id: number; method: "fetch" }
  | { id: number; method: "getSnapshot"; period: PeriodFilter }
  | { id: number; method: "getSettings" }
  | { id: number; method: "saveSettings"; settings: Partial<AppSettings> }
  | { id: number; method: "addPrice"; price: NewPriceEntry };

export type HostResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

export async function respond(reader: UsageReader, message: unknown): Promise<HostResponse> {
  const request = message as HostRequest;
  const id = typeof request?.id === "number" ? request.id : -1;
  try {
    switch (request?.method) {
      case "fetch":
        return { id, ok: true, result: await reader.fetch() };
      case "getSnapshot":
        return { id, ok: true, result: await reader.getSnapshot(request.period) };
      case "getSettings":
        return { id, ok: true, result: await reader.getSettings() };
      case "saveSettings":
        await reader.saveSettings(request.settings);
        // Answers with what is now stored, so the tab shows the truth rather
        // than what it hoped it wrote.
        return { id, ok: true, result: await reader.getSettings() };
      case "addPrice":
        await reader.addPrice(request.price);
        return { id, ok: true, result: null };
      default: {
        const { method } = message as { method?: unknown };
        return { id, ok: false, error: `unknown method ${String(method)}` };
      }
    }
  } catch (error) {
    return { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
