/**
 * The webview's half of the sidecar protocol.
 *
 * Newline JSON, one response per request, relayed by the Rust `sidecar_request`
 * command. Nothing here touches a disk, a socket or the collectors: the sidecar
 * owns all of that, exactly as the VS Code extension host will.
 */

import { invoke } from "@tauri-apps/api/core";
import type { DashboardSnapshot, PeriodFilter } from "@prompt-burn/core";
import type { NewPriceInput, SourceSettings } from "@prompt-burn/ui";

/** What `fetch()` answers with — see `sidecar/reader.ts`. */
export interface FetchResult {
  at: string;
  /** Every source that could run did. Partial success is `false`. */
  ok: boolean;
  error?: string;
  omp: {
    ok: boolean;
    error?: string;
    scannedFiles: number;
    skippedFiles: number;
    insertedEvents: number;
  };
  cursor: { ok: boolean; reason?: string; error?: string; models: number };
}

let lastId = 0;

async function request<T>(method: string, extra: Record<string, unknown> = {}): Promise<T> {
  const id = (lastId += 1);
  const line = await invoke<string>("sidecar_request", {
    request: JSON.stringify({ id, method, ...extra }),
  });

  const response = JSON.parse(line) as {
    id?: unknown;
    ok?: unknown;
    result?: unknown;
    error?: unknown;
  };
  if (response.id !== id) {
    throw new Error(`the sidecar answered ${String(response.id)}, not ${id}`);
  }
  if (response.ok !== true) {
    throw new Error(typeof response.error === "string" ? response.error : "the sidecar refused");
  }
  // The sidecar builds this value from the shared core types; the protocol
  // boundary is the one place the shape is taken on trust.
  return response.result as T;
}

/** Runs both collectors in parallel. A missing source is degraded, not fatal. */
export function fetchUsage(): Promise<FetchResult> {
  return request<FetchResult>("fetch");
}

/** The dashboard view model for one period; the caller owns the filter. */
export function getSnapshot(period: PeriodFilter): Promise<DashboardSnapshot> {
  return request<DashboardSnapshot>("getSnapshot", { period });
}

/** The persisted source toggles and OMP path override. */
export function getSettings(): Promise<SourceSettings> {
  return request<SourceSettings>("getSettings");
}

/** Persists the given keys and answers with what is now stored. */
export function saveSettings(settings: Partial<SourceSettings>): Promise<SourceSettings> {
  return request<SourceSettings>("saveSettings", { settings });
}

/** Inserts one rate; the next `getSnapshot` prices history with it. */
export async function addPrice(price: NewPriceInput): Promise<void> {
  await request<null>("addPrice", { price });
}