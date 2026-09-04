/**
 * Reads OMP session transcripts into `UsageEvent`s.
 *
 * Layout: `~/.omp/agent/sessions/<slugified-cwd>/<timestamp>_<uuid>.jsonl`, one
 * JSON object per line. Subagent transcripts sit one level deeper, in a
 * directory named after the parent session file, and carry their own usage —
 * the walk is recursive or those tokens vanish.
 *
 * Only `type: "message"` lines with `message.role === "assistant"` and a
 * `message.usage` block count. Everything else (the session header, user turns,
 * `custom`, `title_change`, `service_tier_change`, `credential_pin`) has no
 * tokens. OMP's own `cost`, `totalTokens`, `cttl` and `contextSnapshot` are
 * deliberately ignored: we store tokens and price them from `price_entries`.
 *
 * Nothing here writes to the database — incremental sync is a later commit.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalModelId, type UsageEvent } from "@prompt-burn/core";

/** The fields we read off a line. Each one is re-checked at runtime. */
interface OmpLine {
  type?: unknown;
  id?: unknown;
  timestamp?: unknown;
  message?: {
    role?: unknown;
    model?: unknown;
    usage?: { input?: unknown; output?: unknown; cacheRead?: unknown; cacheWrite?: unknown };
  };
}

/** Where OMP keeps its transcripts. */
export function defaultSessionsDirectory(home: string = homedir()): string {
  return join(home, ".omp", "agent", "sessions");
}

/**
 * Every assistant usage line under `directory`, recursively. A missing
 * directory yields nothing: OMP simply has not run on this machine.
 */
export function collectOmpEvents(directory: string = defaultSessionsDirectory()): UsageEvent[] {
  let entries;
  try {
    entries = readdirSync(directory, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }

  const events: UsageEvent[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    events.push(...parseOmpSessionFile(join(entry.parentPath, entry.name)));
  }
  return events;
}

/**
 * Parses one `.jsonl` transcript. The session header is read before the
 * messages it scopes, because `line.id` is only unique inside a file — the
 * session uuid is what makes the event id global.
 *
 * Unparsable lines are skipped rather than throwing: a live session file can be
 * mid-write, and one torn last line must not cost us the whole transcript.
 */
export function parseOmpSessionFile(filePath: string): UsageEvent[] {
  let contents: string;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch {
    return [];
  }

  const events: UsageEvent[] = [];
  let sessionId: string | undefined;
  let offset = 0;

  for (const text of contents.split("\n")) {
    const lineOffset = offset;
    offset += Buffer.byteLength(text, "utf8") + 1;
    if (text.trim() === "") continue;

    let line: OmpLine;
    try {
      line = JSON.parse(text);
    } catch {
      continue;
    }
    if (line === null || typeof line !== "object") continue;

    if (line.type === "session") {
      if (typeof line.id === "string") sessionId = line.id;
      continue;
    }
    const event = toUsageEvent(line, sessionId, filePath, lineOffset);
    if (event) events.push(event);
  }

  return events;
}

function toUsageEvent(
  line: OmpLine,
  sessionId: string | undefined,
  filePath: string,
  offset: number,
): UsageEvent | null {
  if (line.type !== "message") return null;
  const message = line.message;
  if (!message || message.role !== "assistant" || !message.usage) return null;
  if (typeof line.timestamp !== "string" || typeof message.model !== "string") return null;

  const rawModel = message.model;
  return {
    // Without a header there is no session uuid, so fall back to the one thing
    // still unique and stable: where this line sits in this file. Never hash
    // timestamp + model + tokens — two identical tiny turns would collide.
    id:
      sessionId && typeof line.id === "string"
        ? `omp:${sessionId}:${line.id}`
        : `omp:${createHash("sha256").update(`${filePath}:${offset}`).digest("hex").slice(0, 16)}`,
    source: "omp",
    timestamp: line.timestamp,
    model: canonicalModelId(rawModel),
    rawModel,
    tokens: {
      input: count(message.usage.input),
      output: count(message.usage.output),
      cacheRead: count(message.usage.cacheRead),
      cacheWrite: count(message.usage.cacheWrite),
    },
    ...(sessionId ? { sessionId } : {}),
  };
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
