/**
 * Incremental usage sync: what the agents left on disk into `usage_events`.
 *
 * Three collectors share it — OMP's transcripts, Claude Code's, and the `agy`
 * CLI's per-conversation SQLite databases. The two transcript sources differ
 * only in where they live, how one line parses and which `source` the rows
 * carry, so their walk, resume bookkeeping and transaction are written once in
 * `syncTranscripts`. Antigravity needs its own walk (`.db` files, not
 * `.jsonl`) but reuses the same statements, the same state table and the same
 * transaction shape.
 *
 * `omp_sync_state` remembers each file's mtime and how much of it we have
 * consumed, keyed by absolute path — so the sources cannot collide in it even
 * though the table kept OMP's name. A file whose mtime and offset still match
 * its row is not opened at all; that is what makes the second fetch cheap. A
 * grown file resumes at its offset; a shrunk or rewritten one restarts from
 * zero. `offset` is bytes consumed for a transcript and generations consumed
 * for a conversation database — the same "next position" idea either way.
 *
 * Rows are keyed by the parser's stable `UsageEvent.id`, so re-reading the same
 * lines (a torn tail, a restart, a rewritten file) cannot duplicate them.
 * Tokens and timestamps are stored; the tools' own cost fields never are.
 */

import { readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { Source, UsageEvent } from "@prompt-burn/core";
import {
  defaultAgyConversationsDirectory,
  defaultAgySummariesPath,
  readAgyProjects,
  scanAgyConversationFile,
} from "./antigravity-cli.js";
import { defaultClaudeDirectory, scanClaudeSessionFile } from "./claude-code.js";
import { defaultSessionsDirectory, scanOmpSessionFile } from "./omp.js";

/** One transcript parse, resumed from a byte offset. */
type ScanFile = (filePath: string, fromOffset: number) => { events: UsageEvent[]; offset: number };

export interface OmpSyncResult {
  /** Files opened and parsed this run. */
  scannedFiles: number;
  /** Files left untouched because mtime and offset were unchanged. */
  skippedFiles: number;
  /** Rows actually written; a duplicate id counts zero. */
  insertedEvents: number;
}

/**
 * `DO UPDATE` only where the stored row has no project yet: that is the
 * backfill path after the `project` migration cleared `omp_sync_state`, and it
 * leaves `changes` at 0 for a row that is genuinely a re-read, so the counters
 * still say what was written.
 */
const INSERT_EVENT = `
  INSERT INTO usage_events
    (id, source, period, timestamp, model, raw_model, input, output, cache_read, cache_write, session_id, project)
  VALUES (?, ?, 'event', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET project = excluded.project
    WHERE usage_events.project IS NULL AND excluded.project IS NOT NULL`;

const UPSERT_STATE = `
  INSERT INTO omp_sync_state (path, mtime, offset) VALUES (?, ?, ?)
  ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, offset = excluded.offset`;

/**
 * Syncs every OMP transcript under `directory` (recursively — subagent
 * transcripts live one level deeper and carry their own usage) into `db`.
 */
export function syncOmpSessions(
  db: DatabaseSync,
  directory: string = defaultSessionsDirectory(),
): OmpSyncResult {
  return syncTranscripts(db, directory, "omp", scanOmpSessionFile);
}

/**
 * Same, for Claude Code's `~/.claude/projects` tree — the transcripts the VS
 * Code extension and a terminal session both write.
 */
export function syncClaudeSessions(
  db: DatabaseSync,
  directory: string = defaultClaudeDirectory(),
): OmpSyncResult {
  return syncTranscripts(db, directory, "claude-code", scanClaudeSessionFile);
}

/**
 * Same, for the `agy` CLI's conversation databases — one SQLite file per
 * conversation, each holding protobuf generation records rather than lines.
 *
 * The project comes from `conversation_summaries.db`, read once per sync
 * because it covers every conversation. The skip test is mtime alone: the
 * offset counts generations, not bytes, so it cannot be compared against a
 * file size that also moves with SQLite's page allocation.
 */
export function syncAntigravityConversations(
  db: DatabaseSync,
  directory: string = defaultAgyConversationsDirectory(),
  summariesPath: string = defaultAgySummariesPath(),
): OmpSyncResult {
  let entries;
  try {
    entries = readdirSync(directory, { recursive: true, withFileTypes: true });
  } catch {
    // `agy` has never run here, or the configured path is gone. Not an error.
    return { scannedFiles: 0, skippedFiles: 0, insertedEvents: 0 };
  }

  const projects = readAgyProjects(summariesPath);
  const selectState = db.prepare("SELECT mtime, offset FROM omp_sync_state WHERE path = ?");
  const insertEvent = db.prepare(INSERT_EVENT);
  const upsertState = db.prepare(UPSERT_STATE);
  const result: OmpSyncResult = { scannedFiles: 0, skippedFiles: 0, insertedEvents: 0 };

  db.exec("BEGIN");
  try {
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".db")) continue;
      const path = join(entry.parentPath, entry.name);

      let mtime: number;
      try {
        mtime = Math.floor(statSync(path).mtimeMs);
      } catch {
        continue; // Deleted between the walk and the stat.
      }

      const state = selectState.get(path);
      if (state && Number(state["mtime"]) === mtime) {
        result.skippedFiles += 1;
        continue;
      }

      // A database holding fewer generations than the offset claims was
      // rebuilt; `scanAgyConversationFile` restarts it from zero itself.
      const scan = scanAgyConversationFile(
        path,
        projects.get(basename(entry.name, ".db")),
        Number(state?.["offset"] ?? 0),
      );
      result.scannedFiles += 1;
      for (const event of scan.events) {
        result.insertedEvents += insert(insertEvent, "antigravity", event);
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

function syncTranscripts(
  db: DatabaseSync,
  directory: string,
  source: Source,
  scanFile: ScanFile,
): OmpSyncResult {
  let entries;
  try {
    entries = readdirSync(directory, { recursive: true, withFileTypes: true });
  } catch {
    // The tool has never run here, or the configured path is gone. Not an error.
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
      const scan = scanFile(path, knownOffset <= size ? knownOffset : 0);
      result.scannedFiles += 1;
      for (const event of scan.events) {
        result.insertedEvents += insert(insertEvent, source, event);
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

function insert(statement: StatementSync, source: Source, event: UsageEvent): number {
  // The schema forbids an event row without a timestamp; skipping beats
  // aborting the whole sync over one malformed line.
  if (event.timestamp === "") return 0;
  const changes = statement.run(
    event.id,
    source,
    event.timestamp,
    event.model,
    event.rawModel,
    event.tokens.input,
    event.tokens.output,
    event.tokens.cacheRead ?? 0,
    event.tokens.cacheWrite ?? 0,
    event.sessionId ?? null,
    event.project ?? null,
  ).changes;
  return Number(changes);
}
