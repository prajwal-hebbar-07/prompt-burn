/**
 * Reads `usage_events` rows back as the domain's `UsageEvent`s.
 *
 * The one place the SQL column names meet the TypeScript field names — the
 * collectors own writing this table (`sync.ts` mirrors the same schema), the
 * shells read through here. Cycle rows (Cursor Pro) have an empty timestamp by
 * schema contract and survive that way; nothing fakes a time.
 */

import type { DatabaseSync } from "node:sqlite";
import type { Source, UsageEvent } from "@prompt-burn/core";

const COLUMNS = `
  SELECT id, source, timestamp, model, raw_model,
         input, output, cache_read, cache_write, session_id
  FROM usage_events`;

/**
 * Every stored event, oldest first. `source` narrows to one origin — the OMP
 * snapshot read and the (future) Cursor cycle read are separate calls.
 */
export function loadUsageEvents(db: DatabaseSync, source?: Source): UsageEvent[] {
  const rows = (
    source === undefined
      ? db.prepare(`${COLUMNS} ORDER BY timestamp, id`).all()
      : db.prepare(`${COLUMNS} WHERE source = ? ORDER BY timestamp, id`).all(source)
  ) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    id: String(row["id"]),
    source: row["source"] as Source,
    timestamp: String(row["timestamp"]),
    model: String(row["model"]),
    rawModel: String(row["raw_model"]),
    // The schema declares these NOT NULL DEFAULT 0; the pair is always whole.
    tokens: {
      input: Number(row["input"]),
      output: Number(row["output"]),
      cacheRead: Number(row["cache_read"]),
      cacheWrite: Number(row["cache_write"]),
    },
    ...(row["session_id"] === null ? {} : { sessionId: String(row["session_id"]) }),
  }));
}