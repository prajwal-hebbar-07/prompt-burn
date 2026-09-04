/**
 * One fetch pass over every source, run in parallel, with per-source results.
 *
 * Partial success is the normal case, not an edge: a machine with no Cursor
 * session still has OMP transcripts, and a Cursor HTTP failure must never blank
 * OMP's numbers. So nothing here throws — each source reports its own outcome
 * and the shell decides what to show.
 *
 * The Cursor request is started before the OMP sync runs, so the HTTP round
 * trip overlaps the (synchronous) SQLite work rather than queueing behind it.
 *
 * The access token lives in this module's stack only: it is read from Cursor's
 * own `state.vscdb` at fetch time, used for the cookie, and never returned,
 * logged or stored.
 */

import type { DatabaseSync } from "node:sqlite";
import type { CursorSnapshot } from "@prompt-burn/core";
import { readCursorAuth, type CursorAuthUnavailable } from "./cursor-auth.js";
import { fetchCursorCycle } from "./cursor.js";
import { syncOmpSessions, type OmpSyncResult } from "./sync.js";

export interface CollectOptions {
  /** Prompt Burn's database — OMP rows land here; Cursor data never does. */
  db: DatabaseSync;
  /** OMP transcripts root; defaults to `~/.omp/agent/sessions`. */
  ompDirectory?: string;
  /** Cursor's `state.vscdb`; defaults to the macOS global storage path. */
  cursorStatePath?: string;
  /** Injectable so tests never reach cursor.com. */
  fetchImpl?: typeof fetch;
}

export interface CollectResult {
  omp: {
    ok: boolean;
    error?: string;
    /** Zeros when the sync failed or OMP has never run here. */
    sync: OmpSyncResult;
  };
  cursor: {
    ok: boolean;
    /**
     * Why Cursor produced nothing. The auth reasons are local conditions;
     * `fetch_failed` is a transport, HTTP or response-shape failure.
     */
    reason?: CursorAuthUnavailable["reason"] | "fetch_failed";
    error?: string;
    /** Cycle-to-date aggregate; absent unless this pass fetched one. */
    cycle?: CursorSnapshot;
  };
}

const NO_SYNC: OmpSyncResult = { scannedFiles: 0, skippedFiles: 0, insertedEvents: 0 };

/** Runs both collectors. Never throws: every failure is a per-source result. */
export async function collectAllSources(options: CollectOptions): Promise<CollectResult> {
  const { db, ompDirectory, cursorStatePath, fetchImpl } = options;

  // Started first so its I/O is already in flight during the OMP sync.
  const cursor = collectCursor(cursorStatePath, fetchImpl);

  let omp: CollectResult["omp"];
  try {
    omp = { ok: true, sync: syncOmpSessions(db, ompDirectory) };
  } catch (error) {
    // The sync is one transaction and rolls itself back, so stored OMP rows are
    // still the last consistent ones.
    omp = { ok: false, error: message(error), sync: NO_SYNC };
  }

  return { omp, cursor: await cursor };
}

async function collectCursor(
  statePath: string | undefined,
  fetchImpl: typeof fetch | undefined,
): Promise<CollectResult["cursor"]> {
  const auth = readCursorAuth(statePath);
  if (!auth.ok) return { ok: false, reason: auth.reason, error: auth.detail };
  try {
    return { ok: true, cycle: await fetchCursorCycle(auth, fetchImpl) };
  } catch (error) {
    return { ok: false, reason: "fetch_failed", error: message(error) };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
