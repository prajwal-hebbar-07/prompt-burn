/**
 * One fetch pass over every source, run in parallel, with per-source results.
 *
 * Partial success is the normal case, not an edge: a machine with no Cursor
 * session still has OMP transcripts, and a Cursor HTTP failure must never blank
 * anyone else's numbers. So nothing here throws — each source reports its own
 * outcome and the shell decides what to show.
 *
 * The two network calls — Cursor's cycle and Ollama Cloud's usage clocks — are
 * started before the transcript syncs run, so their round trips overlap the
 * (synchronous) SQLite work rather than queueing behind it.
 *
 * Neither access credential leaves this module's stack: Cursor's token is read
 * from its own `state.vscdb` and Ollama's key from OMP's credential store, both
 * at fetch time, used for one header, and never returned, logged or stored.
 */

import type { DatabaseSync } from "node:sqlite";
import type { CursorSnapshot, ProviderLimits } from "@prompt-burn/core";
import {
  defaultAgyConversationsDirectory,
  defaultAgySummariesPath,
} from "./antigravity-cli.js";
import { fetchAntigravityLimits, readAntigravityAuth } from "./antigravity.js";
import { readCursorAuth, type CursorAuthUnavailable } from "./cursor-auth.js";
import { fetchCursorCycle } from "./cursor.js";
import { fetchOllamaLimits, readOllamaKey } from "./ollama.js";
import { ompAgentDatabase } from "./omp-limits.js";
import {
  syncAntigravityConversations,
  syncClaudeSessions,
  syncOmpSessions,
  type OmpSyncResult,
} from "./sync.js";

export interface CollectOptions {
  /** Prompt Burn's database — transcript rows land here; Cursor data never does. */
  db: DatabaseSync;
  /** OMP transcripts root; defaults to `~/.omp/agent/sessions`. */
  ompDirectory?: string;
  /** Claude Code transcripts root; defaults to `~/.claude/projects`. */
  claudeDirectory?: string;
  /** Cursor's `state.vscdb`; defaults to the macOS global storage path. */
  cursorStatePath?: string;
  /** Injectable so tests never reach cursor.com or Google. */
  fetchImpl?: typeof fetch;
  /**
   * `agy`'s raw keychain secret; defaults to the real macOS keychain read.
   * Injectable for the same reason the transcript directories are: a default
   * reaches into the developer's own credentials.
   */
  antigravitySecret?: () => string;
  /**
   * The `agy` CLI's per-conversation records; default
   * `~/.gemini/antigravity-cli/conversations`, with the workspace map beside
   * it. Both injectable so a test never reads the developer's own `~/.gemini`.
   */
  agyConversationsDirectory?: string;
  agySummariesPath?: string;
  /** Settings toggle. A disabled source is not read at all; default on. */
  ompEnabled?: boolean;
  cursorEnabled?: boolean;
  claudeEnabled?: boolean;
  /** The `agy` CLI as a usage source — not the quota card, which has no toggle. */
  antigravityUsageEnabled?: boolean;
}

export interface CollectResult {
  omp: {
    ok: boolean;
    error?: string;
    /** Zeros when the sync failed or OMP has never run here. */
    sync: OmpSyncResult;
  };
  /**
   * Claude Code's transcripts. Its own sync, its own counters: the tokens are
   * a different tool's, even when the Claude subscription behind them is the
   * same one OMP bills against.
   */
  claudeCode: {
    ok: boolean;
    error?: string;
    /** Zeros when the sync failed, is disabled, or Claude Code never ran here. */
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
  /**
   * Antigravity's quota clocks, fetched straight from Google. Same contract as
   * Ollama's: not a usage source, so a failure never fails the pass. Separate
   * from `ollama` because the credential is `agy`'s keychain item rather than
   * anything OMP holds, and it survives unlinking the provider from OMP.
   */
  antigravity: {
    ok: boolean;
    /**
     * `signed_out` — no `agy` session on this machine; `unreadable` — a
     * keychain item we cannot parse; `fetch_failed` — transport, a refused
     * refresh, or the internal endpoint changing shape.
     */
    reason?: "signed_out" | "unreadable" | "fetch_failed";
    error?: string;
    /** Present only when this pass fetched them. */
    limits?: ProviderLimits;
  };
  /**
   * The `agy` CLI's own turns, priced like any other transcript source. Kept
   * apart from `antigravity` above, which is the quota card: one is cost, the
   * other is a provider clock, and they fail independently.
   */
  antigravityUsage: {
    ok: boolean;
    /** `disabled` is the Settings toggle; `sync_failed` is a throw in the scan. */
    reason?: "disabled" | "sync_failed";
    error?: string;
    /** Absent when the source is disabled or its sync threw. */
    sync?: OmpSyncResult;
  };
}

const NO_SYNC: OmpSyncResult = { scannedFiles: 0, skippedFiles: 0, insertedEvents: 0 };

/** Runs every collector. Never throws: every failure is a per-source result. */
export async function collectAllSources(options: CollectOptions): Promise<CollectResult> {
  const {
    db,
    ompDirectory,
    claudeDirectory,
    cursorStatePath,
    fetchImpl,
    antigravitySecret,
    agyConversationsDirectory,
    agySummariesPath,
    ompEnabled = true,
    cursorEnabled = true,
    claudeEnabled = true,
    antigravityUsageEnabled = true,
  } = options;

  // Both network calls start before the local syncs so their round trips
  // overlap the (synchronous) SQLite work rather than queueing behind it. A
  // disabled source is not touched at all — no directory walk, and no read of
  // either provider's local credential store.
  const cursor: Promise<CollectResult["cursor"]> = cursorEnabled
    ? collectCursor(cursorStatePath, fetchImpl)
    : Promise.resolve({ ok: false, reason: "disabled" });
  // Ollama's key lives in OMP's own credential store, so the OMP toggle owns it.
  const ollama: Promise<CollectResult["ollama"]> = ompEnabled
    ? collectOllama(ompDirectory, fetchImpl)
    : Promise.resolve({ ok: false, reason: "disabled" });

  // Antigravity's credential is `agy`'s keychain item, not OMP's — it is read
  // whether or not OMP is enabled, because unlinking the provider from OMP is
  // exactly the case this collector exists for.
  const antigravity = collectAntigravity(antigravitySecret, fetchImpl);

  // Each sync is its own transaction and rolls itself back, so a failure in
  // one leaves the other's rows — and the last consistent state of its own —
  // untouched.
  const omp = sync(() => syncOmpSessions(db, ompDirectory), ompEnabled);
  const claudeCode = sync(() => syncClaudeSessions(db, claudeDirectory), claudeEnabled);
  // The `agy` CLI's conversations. Its own result, its own failure mode: a
  // throw here is one source's problem, never the pass's.
  const antigravityUsage = collectAgyUsage(
    db,
    agyConversationsDirectory ?? defaultAgyConversationsDirectory(),
    agySummariesPath ?? defaultAgySummariesPath(),
    antigravityUsageEnabled,
  );

  return {
    omp,
    claudeCode,
    cursor: await cursor,
    ollama: await ollama,
    antigravity: await antigravity,
    antigravityUsage,
  };
}

/** One transcript sync as a result: disabled is clean and empty, never an error. */
function sync(run: () => OmpSyncResult, enabled: boolean): CollectResult["omp"] {
  if (!enabled) return { ok: true, sync: NO_SYNC };
  try {
    return { ok: true, sync: run() };
  } catch (error) {
    return { ok: false, error: message(error), sync: NO_SYNC };
  }
}

/**
 * The `agy` sync as a result. Unlike the transcript syncs above it carries no
 * zeroed counters when it did not run: `reason` says why, and the absent
 * `sync` says nothing was scanned rather than claiming a clean empty pass.
 */
function collectAgyUsage(
  db: DatabaseSync,
  directory: string,
  summariesPath: string,
  enabled: boolean,
): CollectResult["antigravityUsage"] {
  if (!enabled) return { ok: false, reason: "disabled" };
  try {
    return { ok: true, sync: syncAntigravityConversations(db, directory, summariesPath) };
  } catch (error) {
    return { ok: false, reason: "sync_failed", error: message(error) };
  }
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

async function collectAntigravity(
  secret: (() => string) | undefined,
  fetchImpl: typeof fetch | undefined,
): Promise<CollectResult["antigravity"]> {
  const auth = secret === undefined ? readAntigravityAuth() : readAntigravityAuth(secret);
  if (!auth.ok) return { ok: false, reason: auth.reason, error: auth.detail };
  try {
    return { ok: true, limits: await fetchAntigravityLimits(auth, fetchImpl) };
  } catch (error) {
    return { ok: false, reason: "fetch_failed", error: message(error) };
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
