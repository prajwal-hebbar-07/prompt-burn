/**
 * Cursor Pro cycle aggregates: two POSTs to `cursor.com`, mapped onto
 * `CursorSnapshot` in `cycle_aggregate` mode.
 *
 * The dashboard API only ever returns per-model totals for the current billing
 * cycle, and the cycle window itself is not in that response — hence the second
 * call to `/api/usage-summary`. The body stays `{}`: no date window is sent, so
 * the server answers for the cycle to date. Cursor's own `totalCents` /
 * `totalCostCents` are never read; our estimate is always tokens ×
 * `price_entries`, computed later.
 *
 * Auth is the in-memory `CursorToken` from `cursor-auth.ts`, sent as the WorkOS
 * session cookie. `Origin` is mandatory — cursor.com answers
 * `403 Invalid origin for state-changing request` without it. Nothing here
 * persists or logs the token.
 */

import {
  canonicalModelId,
  type CursorIncludedUsage,
  type CursorSnapshot,
  type TokenCounts,
} from "@prompt-burn/core";
import type { CursorToken } from "./cursor-auth.js";

const ORIGIN = "https://cursor.com";
const SUMMARY_PATH = "/api/usage-summary";
const AGGREGATE_PATH = "/api/dashboard/get-aggregated-usage-events";

/** The `/api/usage-summary` fields we use. Each one is re-checked at runtime. */
interface CursorUsageSummary {
  billingCycleStart?: unknown;
  billingCycleEnd?: unknown;
  /** `{ plan: { autoPercentUsed, apiPercentUsed } }` on a Pro account. */
  individualUsage?: unknown;
}

/** One `aggregations` row. Token totals are decimal strings. */
interface CursorAggregation {
  modelIntent?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  /** Absent when zero. */
  cacheReadTokens?: unknown;
  /** Absent when zero. */
  cacheWriteTokens?: unknown;
}

interface CursorAggregateResponse {
  aggregations?: unknown;
}

/**
 * Cycle-to-date snapshot for the signed-in Cursor account. `fetchImpl` exists
 * so tests stay offline; production passes nothing.
 *
 * Throws on transport, HTTP or shape failure — the caller owns turning that
 * into a per-source error.
 */
export async function fetchCursorCycle(
  token: CursorToken,
  fetchImpl: typeof fetch = fetch,
): Promise<CursorSnapshot> {
  const [summary, aggregate] = await Promise.all([
    post<CursorUsageSummary>(SUMMARY_PATH, token, fetchImpl),
    post<CursorAggregateResponse>(AGGREGATE_PATH, token, fetchImpl),
  ]);

  const { billingCycleStart, billingCycleEnd } = summary;
  if (typeof billingCycleStart !== "string" || typeof billingCycleEnd !== "string") {
    throw new Error(`POST ${SUMMARY_PATH} returned no billing cycle window`);
  }
  if (!Array.isArray(aggregate.aggregations)) {
    throw new Error(`POST ${AGGREGATE_PATH} returned no aggregations array`);
  }
  const rows: CursorAggregation[] = aggregate.aggregations;

  // Absent unless both numbers are there: half a pool is not worth showing.
  const included = includedUsage(summary.individualUsage);

  return {
    mode: "cycle_aggregate",
    cycleStart: billingCycleStart,
    cycleEnd: billingCycleEnd,
    // One row per `modelIntent`, `default` (Auto) included: it has real tokens
    // and no public rate, and must surface as an unknown-price row rather than
    // vanish. Two intents can canonicalize to the same id (`…-high-fast`
    // collapses onto `…-high`); the core rollup merges those.
    models: rows.map((row) => ({
      model: canonicalModelId(typeof row.modelIntent === "string" ? row.modelIntent : "unknown"),
      tokens: tokens(row),
    })),
    // Cursor's own plan percentages, for the limits panel.
    ...(included ? { included } : {}),
  };
}

/**
 * `individualUsage.plan`'s Auto and named-model percentages, or `undefined`.
 *
 * These are the only numbers this app takes from Cursor about Cursor's own
 * plan: they are percentages of an included pool, not tokens and not cost, and
 * they never reach `estimatedCents`. A team account answers with `teamUsage`
 * instead and gets nothing here.
 */
function includedUsage(individualUsage: unknown): CursorIncludedUsage | undefined {
  if (typeof individualUsage !== "object" || individualUsage === null) return undefined;
  const { plan } = individualUsage as { plan?: unknown };
  if (typeof plan !== "object" || plan === null) return undefined;
  const { autoPercentUsed, apiPercentUsed } = plan as {
    autoPercentUsed?: unknown;
    apiPercentUsed?: unknown;
  };
  if (typeof autoPercentUsed !== "number" || !Number.isFinite(autoPercentUsed)) return undefined;
  if (typeof apiPercentUsed !== "number" || !Number.isFinite(apiPercentUsed)) return undefined;
  return { autoPercentUsed, apiPercentUsed };
}

/** Cycle counts. A cache key Cursor omitted stays omitted — never a fake `0`. */
function tokens(row: CursorAggregation): TokenCounts {
  const counts: TokenCounts = { input: count(row.inputTokens), output: count(row.outputTokens) };
  if (row.cacheReadTokens !== undefined) counts.cacheRead = count(row.cacheReadTokens);
  if (row.cacheWriteTokens !== undefined) counts.cacheWrite = count(row.cacheWriteTokens);
  return counts;
}

function count(value: unknown): number {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

async function post<T>(path: string, token: CursorToken, fetchImpl: typeof fetch): Promise<T> {
  const response = await fetchImpl(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      Cookie: `WorkosCursorSessionToken=${encodeURIComponent(token.userId)}%3A%3A${token.token}`,
    },
    // Empty body = current billing cycle. Date windows are deliberately unused.
    body: "{}",
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`POST ${path} -> ${response.status} ${body.slice(0, 200)}`);
  // `JSON.parse` is the boundary: the shape is re-checked field by field above.
  return JSON.parse(body);
}
