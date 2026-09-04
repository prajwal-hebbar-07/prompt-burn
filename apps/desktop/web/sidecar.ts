/**
 * The webview's half of the sidecar protocol.
 *
 * Newline JSON, one response per request, relayed by the Rust `sidecar_request`
 * command. Nothing here touches a disk, a socket or the collectors: the sidecar
 * owns all of that, exactly as the VS Code extension host will.
 */

import { invoke } from "@tauri-apps/api/core";
import type { DashboardSnapshot, PeriodFilter } from "@prompt-burn/core";

/** What `fetch()` answers with — see `sidecar/reader.ts`. */
export interface FetchResult {
  at: string;
  ok: boolean;
  error?: string;
  omp: { scannedFiles: number; skippedFiles: number; insertedEvents: number };
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

/** Runs the incremental OMP sync. A missing source is zeros, not a failure. */
export function fetchUsage(): Promise<FetchResult> {
  return request<FetchResult>("fetch");
}

/** The dashboard view model for one period; the caller owns the filter. */
export function getSnapshot(period: PeriodFilter): Promise<DashboardSnapshot> {
  return request<DashboardSnapshot>("getSnapshot", { period });
}