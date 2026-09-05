/**
 * Provider usage clocks, read out of OMP's own agent database.
 *
 * OMP asks each provider what is left on the subscription — Anthropic's
 * `/api/oauth/usage`, Antigravity's quota call — and appends every answer to
 * `usage_history` in `~/.omp/agent/agent.db`. That table is the only local
 * record of those numbers, so this reader takes the newest row per
 * `(provider, account, limit)` and hands it over unchanged. Nothing is
 * recomputed: the fraction is the provider's own answer about its own window,
 * and it has no relationship to our token counts or estimated cost.
 *
 * Two things are deliberately not read. `usage_history.email` and
 * `account_id` stay in OMP's database — a card labelled `Account A` needs
 * neither — and rows older than the longest window a provider reports (7 days)
 * are dropped, because a stale observation describes a window that has already
 * rolled over, and a deleted credential's rows never disappear from the table.
 *
 * Read-only, and every failure is emptiness: OMP may never have run here, or
 * may predate the table. The database is live — OMP writes it while this reads
 * — so the open is `mode=ro` without `immutable`, which would hide its WAL.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ProviderLimits } from "@prompt-burn/core";
import { defaultSessionsDirectory } from "./omp.js";

/**
 * OMP's agent database, the sibling of the sessions directory: a Settings path
 * override moves both together, because both belong to the same OMP install.
 */
export function ompAgentDatabase(sessionsDirectory: string = defaultSessionsDirectory()): string {
  return join(sessionsDirectory, "..", "agent.db");
}

/** The longest window any provider reports. Older rows describe nothing current. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The newest row of every series. SQLite's bare-column rule applies: with one
 * `MAX()` aggregate, the unaggregated columns come from the row that holds the
 * maximum, so this is the latest observation per limit and not a mix of rows.
 */
const LATEST_PER_LIMIT = `
  SELECT provider, account_key, limit_id, label, window_label, used_fraction, resets_at,
         MAX(recorded_at) AS recorded_at
    FROM usage_history
   GROUP BY provider, account_key, limit_id
   ORDER BY provider, account_key, limit_id`;

/**
 * Every provider limit OMP has recently observed, grouped per account and
 * ordered by `(provider, account)` so the UI's `Account A` / `Account B`
 * labels stay put between snapshots.
 */
export function readOmpLimits(
  databaseFile: string = ompAgentDatabase(),
  now: Date = new Date(),
): ProviderLimits[] {
  if (!existsSync(databaseFile)) return [];

  let rows: Record<string, unknown>[];
  try {
    const db = new DatabaseSync(`file:${databaseFile}?mode=ro`, { readOnly: true });
    try {
      rows = db.prepare(LATEST_PER_LIMIT).all();
    } finally {
      db.close();
    }
  } catch {
    // No `usage_history` (an older OMP), or the file is not readable at all.
    return [];
  }

  const oldest = now.getTime() - MAX_AGE_MS;
  const groups = new Map<string, ProviderLimits>();

  for (const row of rows) {
    // Every timestamp in this table is epoch milliseconds; SQL NULL arrives as
    // `null`, which is not a number and drops the row or the clock.
    const recordedAt = row["recorded_at"];
    if (typeof recordedAt !== "number" || recordedAt < oldest) continue;

    const provider = text(row["provider"]);
    const id = text(row["limit_id"]);
    if (!provider || !id) continue;

    // The account key holds an email and an org id; it is a grouping key here
    // and never leaves this function.
    const key = `${provider}\u0000${text(row["account_key"])}`;
    let group = groups.get(key);
    if (!group) {
      group = { provider, observedAt: new Date(recordedAt).toISOString(), limits: [] };
      groups.set(key, group);
    } else if (recordedAt > Date.parse(group.observedAt)) {
      group.observedAt = new Date(recordedAt).toISOString();
    }

    const windowLabel = text(row["window_label"]);
    const used = row["used_fraction"];
    const resetsAt = row["resets_at"];
    group.limits.push({
      id,
      label: text(row["label"]) || id,
      ...(windowLabel ? { windowLabel } : {}),
      // Clamped: a provider reporting 104% has simply run out.
      usedFraction: typeof used === "number" ? Math.min(Math.max(used, 0), 1) : null,
      resetsAt: typeof resetsAt === "number" ? new Date(resetsAt).toISOString() : null,
    });
  }

  return [...groups.values()];
}

/** Five columns of this table are text-or-NULL and every one is optional. */
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
