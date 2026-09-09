/**
 * Reads Claude Code transcripts into `UsageEvent`s.
 *
 * Claude Code is the CLI the VS Code extension drives: the editor panel and a
 * terminal session write the same files, so one collector covers both. Layout:
 * `~/.claude/projects/<slugified-cwd>/<session-uuid>.jsonl`, one JSON object
 * per line, walked recursively like OMP's.
 *
 * Only lines with `message.role === "assistant"` and a `message.usage` block
 * count. Unlike OMP there is no session header: every line carries its own
 * `cwd` and `sessionId`, so project attribution never depends on line 1.
 *
 * Token field names are Anthropic's API names — `input_tokens`,
 * `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens` —
 * not OMP's. Costs Claude Code may have written (`costUSD` on older versions)
 * are ignored, like OMP's: we store tokens and price them from `price_entries`.
 *
 * Nothing here writes to the database; `sync.ts` owns that.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalModelId, type UsageEvent } from "@prompt-burn/core";

/**
 * The fields we read off a line. Each one is re-checked at runtime.
 *
 * `type` is deliberately absent: `message.role === "assistant"` plus a
 * `message.usage` block is the whole filter, so a renamed or unfamiliar line
 * type cannot silently drop real usage.
 */
interface ClaudeLine {
  /** Per-line uuid, unique inside one transcript. */
  uuid?: unknown;
  /** Anthropic's request id; with `message.id` it identifies one API response. */
  requestId?: unknown;
  timestamp?: unknown;
  sessionId?: unknown;
  /** The directory Claude Code ran in — our project identity, on every line. */
  cwd?: unknown;
  message?: {
    id?: unknown;
    role?: unknown;
    model?: unknown;
    usage?: {
      input_tokens?: unknown;
      output_tokens?: unknown;
      cache_read_input_tokens?: unknown;
      cache_creation_input_tokens?: unknown;
    };
  };
}

/**
 * Claude Code's stand-in model on locally generated messages (interrupts, API
 * errors). No provider ran, so there are no tokens to price.
 */
const SYNTHETIC_MODEL = "<synthetic>";

/**
 * Where Claude Code keeps its transcripts. `CLAUDE_CONFIG_DIR` relocates the
 * whole config directory and is honoured here.
 *
 * ponytail: newer builds accept a comma-separated list there; only the first
 * entry is read. Walk them all if anyone actually runs a split config.
 */
export function defaultClaudeDirectory(
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env["CLAUDE_CONFIG_DIR"]?.split(",")[0]?.trim();
  return join(configured === undefined || configured === "" ? join(home, ".claude") : configured, "projects");
}

/**
 * Every assistant usage line under `directory`, recursively. A missing
 * directory yields nothing: Claude Code simply has not run on this machine.
 */
export function collectClaudeEvents(directory: string = defaultClaudeDirectory()): UsageEvent[] {
  let entries;
  try {
    entries = readdirSync(directory, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }

  const events: UsageEvent[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    events.push(...parseClaudeSessionFile(join(entry.parentPath, entry.name)));
  }
  return events;
}

/** A resumable read of one transcript, byte-identical in shape to OMP's. */
export interface ClaudeFileScan {
  events: UsageEvent[];
  /**
   * Bytes consumed: the offset just past the last line that ended in a
   * newline. A torn final line is left unconsumed so the next sync re-reads it.
   */
  offset: number;
}

/**
 * Parses one `.jsonl` transcript.
 *
 * Unparsable lines are skipped rather than throwing: a live session file can be
 * mid-write, and one torn last line must not cost us the whole transcript.
 */
export function parseClaudeSessionFile(filePath: string): UsageEvent[] {
  return scanClaudeSessionFile(filePath).events;
}

/**
 * Same parse, resumed from `fromOffset` — the incremental path. Every line
 * stands alone here, so unlike OMP's scan nothing before the offset has to be
 * read for context: those lines are skipped outright.
 */
export function scanClaudeSessionFile(filePath: string, fromOffset = 0): ClaudeFileScan {
  let contents: string;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch {
    return { events: [], offset: 0 };
  }

  const events: UsageEvent[] = [];
  let offset = 0;
  let consumed = 0;

  const texts = contents.split("\n");
  for (const [index, text] of texts.entries()) {
    const lineOffset = offset;
    offset += Buffer.byteLength(text, "utf8") + 1;
    // Only the final piece can lack its terminating newline; until one arrives
    // the line may be half-written, so it stays outside the consumed range.
    if (index < texts.length - 1) consumed = offset;
    if (lineOffset < fromOffset || text.trim() === "") continue;

    let line: ClaudeLine;
    try {
      line = JSON.parse(text);
    } catch {
      continue;
    }
    if (line === null || typeof line !== "object") continue;

    const event = toUsageEvent(line, filePath, lineOffset);
    if (event) events.push(event);
  }

  return { events, offset: consumed };
}

function toUsageEvent(line: ClaudeLine, filePath: string, offset: number): UsageEvent | null {
  const message = line.message;
  if (!message || message.role !== "assistant" || !message.usage) return null;
  if (typeof line.timestamp !== "string" || typeof message.model !== "string") return null;
  if (message.model === SYNTHETIC_MODEL) return null;

  const rawModel = message.model;
  const sessionId = typeof line.sessionId === "string" ? line.sessionId : undefined;
  const project = typeof line.cwd === "string" && line.cwd !== "" ? line.cwd : undefined;

  return {
    id: eventId(line, sessionId, filePath, offset),
    source: "claude-code",
    timestamp: line.timestamp,
    model: canonicalModelId(rawModel),
    rawModel,
    tokens: {
      input: count(message.usage.input_tokens),
      output: count(message.usage.output_tokens),
      cacheRead: count(message.usage.cache_read_input_tokens),
      cacheWrite: count(message.usage.cache_creation_input_tokens),
    },
    ...(sessionId ? { sessionId } : {}),
    ...(project ? { project } : {}),
  };
}

/**
 * One API response's identity, in falling order of strength.
 *
 * `message.id` + `requestId` is the strongest: resuming or branching a session
 * copies earlier turns into a new transcript, and those copies carry the
 * original response's ids — so keying on them is what stops one turn being
 * counted twice. The per-line uuid is the fallback, and file position the last
 * resort. Never a hash of timestamp + model + tokens: two identical tiny turns
 * would collide.
 */
function eventId(
  line: ClaudeLine,
  sessionId: string | undefined,
  filePath: string,
  offset: number,
): string {
  const messageId = line.message?.id;
  if (typeof messageId === "string" && typeof line.requestId === "string") {
    return `claude-code:${messageId}:${line.requestId}`;
  }
  if (typeof line.uuid === "string") {
    return `claude-code:${sessionId ?? "unknown"}:${line.uuid}`;
  }
  return `claude-code:${createHash("sha256").update(`${filePath}:${offset}`).digest("hex").slice(0, 16)}`;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
