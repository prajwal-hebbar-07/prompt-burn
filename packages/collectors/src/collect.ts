/**
 * One fetch pass over every source, run in parallel, with per-source results.
 *
 * Partial success is the normal case, not an edge: a machine with no Cursor
 * session still has OMP transcripts, and a Cursor HTTP failure must never blank
 * OMP's numbers. So nothing here throws — each source reports its own outcome
 * and the shell decides what to show.
 *
 * The two network calls — Cursor's cycle and Ollama Cloud's usage clocks — are
 * started before the OMP sync runs, so their round trips overlap the
 * (synchronous) SQLite work rather than queueing behind it.
 *
 * Neither access credential leaves this module's stack: Cursor's token is read
 * from its own `state.vscdb` and Ollama's key from OMP's credential store, both
 * at fetch time, used for one header, and never returned, logged or stored.
 */

import type { DatabaseSync } from "node:sqlite";
import type { CursorSnapshot, ProviderLimits } from "@prompt-burn/core";
import { readCursorAuth, type CursorAuthUnavailable } from "./cursor-auth.js";
import { fetchCursorCycle } from "./cursor.js";
import { fetchOllamaLimits, readOllamaKey } from "./ollama.js";
import { ompAgentDatabase } from "./omp-limits.js";
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
  /** Settings toggle. A disabled source is not read at all; default on. */
  ompEnabled?: boolean;
  cursorEnabled?: boolean;
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
     * Why Cursor produced nothing. The auth reasons are local conditions,
     * `disabled` is the Settings toggle, and `fetch_failed` is a transport,
     * HTTP or response-shape failure.
     */
    reason?: CursorAuthUnavailable["reason"] | "fetch_failed" | "disabled";
    error?: string;
    /** Cycle-to-date aggregate; absent unless this pass fetched one. */
    cycle?: CursorSnapshot;
  };
  /**
   * Ollama Cloud's usage clocks. Not a usage source — no events, no tokens,
   * no cost — so a failure here never makes the pass itself a failure: the
   * limits panel loses one card and every number stays.
   */
  ollama: {
    ok: boolean;
    /**
     * `signed_out` — OMP holds no Ollama key; `disabled` is the OMP toggle;
     * `fetch_failed` covers transport, HTTP (401 on a dead key) and the
     * undocumented endpoint changing shape.
     */
    reason?: "signed_out" | "fetch_failed" | "disabled";
    error?: string;
    /** Present only when this pass fetched them. */
    limits?: ProviderLimits;
  };
}

const NO_SYNC: OmpSyncResult = { scannedFiles: 0, skippedFiles: 0, insertedEvents: 0 };

/** Runs both collectors. Never throws: every failure is a per-source result. */
export async function collectAllSources(options: CollectOptions): Promise<CollectResult> {
  const {
    db,
    ompDirectory,
    cursorStatePath,
    fetchImpl,
    ompEnabled = true,
    cursorEnabled = true,
  } = options;

  // Both network calls start before the OMP sync so their round trips overlap
  // the (synchronous) SQLite work rather than queueing behind it. A disabled
  // source is not touched at all — no directory walk, and no read of either
  // provider's local credential store.
  const cursor: Promise<CollectResult["cursor"]> = cursorEnabled
    ? collectCursor(cursorStatePath, fetchImpl)
    : Promise.resolve({ ok: false, reason: "disabled" });
  // Ollama's key lives in OMP's own credential store, so the OMP toggle owns it.
  const ollama: Promise<CollectResult["ollama"]> = ompEnabled
    ? collectOllama(ompDirectory, fetchImpl)
    : Promise.resolve({ ok: false, reason: "disabled" });

  let omp: CollectResult["omp"];
  if (!ompEnabled) {
    omp = { ok: true, sync: NO_SYNC };
  } else {
    try {
      omp = { ok: true, sync: syncOmpSessions(db, ompDirectory) };
    } catch (error) {
      // The sync is one transaction and rolls itself back, so stored OMP rows
      // are still the last consistent ones.
      omp = { ok: false, error: message(error), sync: NO_SYNC };
    }
  }

  return { omp, cursor: await cursor, ollama: await ollama };
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

async function collectOllama(
  ompDirectory: string | undefined,
  fetchImpl: typeof fetch | undefined,
): Promise<CollectResult["ollama"]> {
  const key = readOllamaKey(ompDirectory === undefined ? undefined : ompAgentDatabase(ompDirectory));
  if (key === undefined) {
    return { ok: false, reason: "signed_out", error: "OMP holds no Ollama Cloud key" };
  }
  try {
    return { ok: true, limits: await fetchOllamaLimits(key, fetchImpl) };
  } catch (error) {
    return { ok: false, reason: "fetch_failed", error: message(error) };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
