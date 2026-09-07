/**
 * Cursor Pro aggregates: mapped onto `CursorSnapshot` in `cycle_aggregate`
 * mode by `fetchCursorCycle`, or narrowed to one calendar window by
 * `fetchCursorWindowAggregate`.
 *
 * `get-aggregated-usage-events` answers for the current billing cycle when the
 * body is `{}`, and for an arbitrary window given `startDate` / `endDate` in
 * epoch milliseconds as strings. Both answers are per-model totals with no
 * timestamps — narrowing happens server-side, which is the only way a day or a
 * month gets real Cursor numbers. The cycle window itself is not in that
 * response, hence the second call to `/api/usage-summary`; a windowed fetch
 * skips it and reuses the cycle metadata the caller already holds.
 *
 * One hard limit, from Cursor: a window may not span both 2025-08-01 and
 * 2026-05-14, so an unbounded (all-time) window is never requested. Cursor's
 * own `totalCents` / `totalCostCents` are never read; our estimate is always
 * tokens × `price_entries`, computed later.
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
  type CursorWindow,
  type ModelAggregate,
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
    post<CursorAggregateResponse>(AGGREGATE_PATH, token, fetchImpl, {}),
  ]);

  const { billingCycleStart, billingCycleEnd } = summary;
  if (typeof billingCycleStart !== "string" || typeof billingCycleEnd !== "string") {
    throw new Error(`POST ${SUMMARY_PATH} returned no billing cycle window`);
  }
  const models = aggregateModels(aggregate);

  // Absent unless both numbers are there: half a pool is not worth showing.
  const included = includedUsage(summary.individualUsage);

  return {
    mode: "cycle_aggregate",
    cycleStart: billingCycleStart,
    cycleEnd: billingCycleEnd,
    models,
    // Cursor's own plan percentages, for the limits panel.
    ...(included ? { included } : {}),
  };
}

/** Per-model totals for one calendar window, and the window they cover. */
export interface CursorWindowAggregate {
  window: CursorWindow;
  models: ModelAggregate[];
}

/**
 * The same per-model aggregates, narrowed by Cursor to `[start, end)`. One
 * call: cycle dates and plan percentages do not move with the period, so the
 * caller keeps the ones its last cycle fetch returned.
 *
 * `start` and `end` are epoch milliseconds. Cursor refuses a window spanning
 * its two backend boundaries, so callers must not ask for all time; a refusal
 * throws like any other HTTP failure and the caller falls back to the cycle.
 */
export async function fetchCursorWindowAggregate(
  token: CursorToken,
  { start, end }: { start: number; end: number },
  fetchImpl: typeof fetch = fetch,
): Promise<CursorWindowAggregate> {
  const aggregate = await post<CursorAggregateResponse>(AGGREGATE_PATH, token, fetchImpl, {
    // `teamId: 0` is the individual account; the dates are strings of epoch ms.
    teamId: 0,
    startDate: String(start),
    endDate: String(end),
  });
  return {
    window: { start: new Date(start).toISOString(), end: new Date(end).toISOString() },
    models: aggregateModels(aggregate),
  };
}

/**
 * One row per `modelIntent`, `default` (Auto) included: it has real tokens and
 * no public rate, and must surface as an unknown-price row rather than vanish.
 * Two intents can canonicalize to the same id (`…-high-fast` collapses onto
 * `…-high`); the core rollup merges those.
 */
function aggregateModels(response: CursorAggregateResponse): ModelAggregate[] {
  if (!Array.isArray(response.aggregations)) {
    throw new Error(`POST ${AGGREGATE_PATH} returned no aggregations array`);
  }
  const rows: CursorAggregation[] = response.aggregations;
  return rows.map((row) => ({
    model: canonicalModelId(typeof row.modelIntent === "string" ? row.modelIntent : "unknown"),
    tokens: tokens(row),
  }));
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

/** Window counts. A cache key Cursor omitted stays omitted — never a fake `0`. */
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

async function post<T>(
  path: string,
  token: CursorToken,
  fetchImpl: typeof fetch,
  // `{}` on the aggregate call means the current billing cycle; a window is
  // `{ teamId, startDate, endDate }`. `/api/usage-summary` takes no body.
  payload: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetchImpl(`${ORIGIN}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      Cookie: `WorkosCursorSessionToken=${encodeURIComponent(token.userId)}%3A%3A${token.token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`POST ${path} -> ${response.status} ${body.slice(0, 200)}`);
  // `JSON.parse` is the boundary: the shape is re-checked field by field above.
  return JSON.parse(body);
}
