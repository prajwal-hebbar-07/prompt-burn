/**
 * The host's half of the webview protocol, kept out of `extension.ts` so it is
 * testable without a running editor: one request in, one response out, no
 * `vscode` import.
 *
 * Two commands only. `fetch` runs the collectors and answers with the pass
 * result; `getSnapshot` re-aggregates what is already stored for one period, so
 * a period change costs no I/O beyond the database. `id` pairs answers with
 * requests, because `postMessage` is one shared channel and two requests can
 * overlap.
 *
 * Errors are answers here — the reader's `fetch` never throws, and a malformed
 * request or a failed `getSnapshot` comes back as `ok: false` instead of
 * killing the message handler.
 */

import type { PeriodFilter } from "@prompt-burn/core";
import type { UsageReader } from "@prompt-burn/reader";

export type HostRequest =
  | { id: number; method: "fetch" }
  | { id: number; method: "getSnapshot"; period: PeriodFilter };

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
      default: {
        const { method } = message as { method?: unknown };
        return { id, ok: false, error: `unknown method ${String(method)}` };
      }
    }
  } catch (error) {
    return { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
