/**
 * Incremental OMP sync: session transcripts on disk into `usage_events`.
 *
 * `omp_sync_state` remembers each file's mtime and how many bytes we have
 * consumed. A file whose mtime and size still match its row is not opened at
 * all — that is what makes the second fetch cheap. A grown file resumes at its
 * offset; a shrunk or rewritten one restarts from byte 0.
 *
 * Rows are keyed by the parser's stable `UsageEvent.id`, so re-reading the same
 * lines (a torn tail, a restart, a rewritten file) cannot duplicate them.
 * Tokens and timestamps are stored; OMP's own `usage.cost` never is.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { UsageEvent } from "@prompt-burn/core";
import { defaultSessionsDirectory, scanOmpSessionFile } from "./omp.js";

export interface OmpSyncResult {
  /** Files opened and parsed this run. */
  scannedFiles: number;
  /** Files left untouched because mtime and offset were unchanged. */
  skippedFiles: number;
  /** Rows actually written; a duplicate id counts zero. */
  insertedEvents: number;
}

const INSERT_EVENT = `
  INSERT OR IGNORE INTO usage_events
    (id, source, period, timestamp, model, raw_model, input, output, cache_read, cache_write, session_id)
  VALUES (?, 'omp', 'event', ?, ?, ?, ?, ?, ?, ?, ?)`;

const UPSERT_STATE = `
  INSERT INTO omp_sync_state (path, mtime, offset) VALUES (?, ?, ?)
  ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, offset = excluded.offset`;

/**
 * Syncs every transcript under `directory` (recursively — subagent transcripts
 * live one level deeper and carry their own usage) into `db`.
 */
export function syncOmpSessions(
  db: DatabaseSync,
  directory: string = defaultSessionsDirectory(),
): OmpSyncResult {
  let entries;
  try {
    entries = readdirSync(directory, { recursive: true, withFileTypes: true });
  } catch {
    // OMP has never run here, or the configured path is gone. Not an error.
    return { scannedFiles: 0, skippedFiles: 0, insertedEvents: 0 };
  }

  const selectState = db.prepare("SELECT mtime, offset FROM omp_sync_state WHERE path = ?");
  const insertEvent = db.prepare(INSERT_EVENT);
  const upsertState = db.prepare(UPSERT_STATE);
  const result: OmpSyncResult = { scannedFiles: 0, skippedFiles: 0, insertedEvents: 0 };

  db.exec("BEGIN");
  try {
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const path = join(entry.parentPath, entry.name);

      let mtime: number;
      let size: number;
      try {
        const stats = statSync(path);
        mtime = Math.floor(stats.mtimeMs);
        size = stats.size;
      } catch {
        continue; // Deleted between the walk and the stat.
      }

      const state = selectState.get(path);
      const knownOffset = Number(state?.["offset"] ?? 0);
      if (state && Number(state["mtime"]) === mtime && knownOffset === size) {
        result.skippedFiles += 1;
        continue;
      }

      // A file that shrank was rewritten, not appended to: start over.
      const scan = scanOmpSessionFile(path, knownOffset <= size ? knownOffset : 0);
      result.scannedFiles += 1;
      for (const event of scan.events) {
        result.insertedEvents += insert(insertEvent, event);
      }
      upsertState.run(path, mtime, scan.offset);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return result;
}

function insert(statement: StatementSync, event: UsageEvent): number {
  // The schema forbids an event row without a timestamp; skipping beats
  // aborting the whole sync over one malformed line.
  if (event.timestamp === "") return 0;
  const changes = statement.run(
    event.id,
    event.timestamp,
    event.model,
    event.rawModel,
    event.tokens.input,
    event.tokens.output,
    event.tokens.cacheRead ?? 0,
    event.tokens.cacheWrite ?? 0,
    event.sessionId ?? null,
  ).changes;
  return Number(changes);
}
