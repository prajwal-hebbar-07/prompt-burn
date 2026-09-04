/**
 * The webview's half of the extension-host protocol.
 *
 * `postMessage` in, one answer per `id` out. Nothing here touches a disk, a
 * socket or the collectors — the extension host owns all of that, exactly as
 * the Node sidecar does for the desktop window.
 */

import type { DashboardSnapshot, PeriodFilter } from "@prompt-burn/core";

/** VS Code's webview bridge, injected into the page by the editor. */
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

/**
 * What the host answers a `fetch` with. Narrower than the reader's own
 * `FetchResult` on purpose: the webview needs the timestamp, the combined
 * verdict and which sources ran, and takes nothing else on trust.
 */
export interface FetchOutcome {
  at: string;
  /** Every source that could run did. Partial success is `false`. */
  ok: boolean;
  error?: string;
  omp: { ok: boolean };
  cursor: { ok: boolean };
}

const vscode = acquireVsCodeApi();

let lastId = 0;
const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

window.addEventListener("message", (event: MessageEvent) => {
  const response = event.data as { id?: unknown; ok?: unknown; result?: unknown; error?: unknown };
  if (typeof response?.id !== "number") return;
  const waiting = pending.get(response.id);
  if (!waiting) return;
  pending.delete(response.id);
  if (response.ok === true) waiting.resolve(response.result);
  else waiting.reject(new Error(typeof response.error === "string" ? response.error : "the host refused"));
});

function request<T>(method: string, extra: Record<string, unknown> = {}): Promise<T> {
  const id = (lastId += 1);
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    vscode.postMessage({ id, method, ...extra });
  });
}

/** Runs both collectors. A missing source is degraded, not fatal. */
export function fetchUsage(): Promise<FetchOutcome> {
  return request<FetchOutcome>("fetch");
}

/** The dashboard view model for one period; the caller owns the filter. */
export function getSnapshot(period: PeriodFilter): Promise<DashboardSnapshot> {
  return request<DashboardSnapshot>("getSnapshot", { period });
}
