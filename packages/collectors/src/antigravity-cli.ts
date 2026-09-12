/**
 * Reads the `agy` CLI's own generations into `UsageEvent`s — the cost behind
 * the Antigravity quota clocks.
 *
 * `antigravity.ts` asks Google what is left of the 5-hour and weekly windows,
 * so Antigravity was already on screen as a limit while costing an apparent
 * $0.00. That is because `agy` is its own agent: its turns never land in an OMP
 * transcript or a Claude Code one, and no other reader here looks at its files.
 * This module is the missing half — the priceable record `agy` keeps locally.
 *
 * Layout: one SQLite database per conversation at
 * `~/.gemini/antigravity-cli/conversations/<conversation-id>.db`, with
 * `~/.gemini/antigravity-cli/conversation_summaries.db` mapping a conversation
 * to the workspace it ran in (our `project`). A conversation the user is
 * talking to right now is mid-write, so every open here is read-only with
 * `immutable=1`, exactly like Cursor's `state.vscdb` in `cursor-auth.ts`. We
 * never write to `agy`'s files.
 *
 * The rows are not JSON. `gen_metadata(idx, data, size)` holds one *unframed
 * protobuf message* per model generation, with no descriptor shipped anywhere
 * we can read, so `decodeProtobufFields` walks the wire format generically and
 * keys what it finds by dotted field path (`1.4.2` = field 1 → field 4 → field
 * 2). The map below is what that walk found over 49 real conversations on this
 * machine (1,713 priceable generations), not a guess:
 *
 * - `1.19` — the model id string, e.g. `gemini-3.8-flash`. Present on 1,713 of
 *   1,855 rows across every conversation on the machine this was derived from;
 *   a row without one is not priceable and is skipped rather than charged to an
 *   invented model.
 * - `1.4.2` — prompt/input tokens for that request. It grows through a
 *   conversation as context accumulates (max observed 257,827, against the
 *   context windows the same blobs report at `1.9.10.4` — 256,000 on 1,614
 *   rows, 160,000 on 241), which is what a per-request prompt count looks like.
 * - `1.4.3` — total output tokens, and the billable one. Verified identity:
 *   `1.4.3 == 1.4.9 + 1.4.10` on 1,538 of 1,538 rows carrying all three —
 *   thinking plus emitted text. Google bills thinking at the output rate, so
 *   `1.4.3` is taken whole and `1.4.9`/`1.4.10` are never added on top of it.
 * - `1.4.5` — deliberately unidentified, deliberately unpriced. It ranges
 *   8,113 to 259,867 and exceeds `1.4.2` on early rows, so it is *not* a cached
 *   subset of the prompt. Guessing it would be inventing money.
 * - `1.17.2.*` — a mirror of `1.4.*`. Nothing here reads it: every count is
 *   pulled by its exact path, so the mirror sits in the decoded map under its
 *   own keys and cannot double a total.
 * - `steps(idx, metadata, step_payload, …)`, `metadata` field `1.1` — the
 *   step's timestamp, a varint in epoch seconds. Cross-checked against
 *   `brain/<id>/.system_generated/logs/transcript.jsonl`: for conversation
 *   `d2a5efbb-…`, step 0 → `2026-09-11T10:10:31` and step 2 →
 *   `2026-09-11T10:10:33`, matching `created_at` for the same `step_index`.
 *   Every `gen_metadata.idx` in the sample exists in `steps.idx` (0 missing),
 *   so the join is total — but a row that somehow resolves no timestamp is
 *   skipped, never given "now".
 *
 * Cache caveat, stated rather than buried: input is priced at the **full**
 * input rate with `cacheRead`/`cacheWrite` left at 0, because `agy`'s record
 * exposes no cached-token count we were able to identify (see `1.4.5`). Where
 * Google served part of a prompt from its context cache, this **over-estimates**
 * — the same documented class of bias as the Ollama peak-window under-estimate
 * recorded in `packages/db/src/prices.ts`.
 *
 * `agy` is not Gemini-only: the same 1,855 rows carry `gemini-3.8-flash`
 * (1,435), `gemini-3.8-flash-tiered` (103), `claude-sonnet-4-6` (119) and
 * `claude-opus-4-6-thinking` (56). Only the first has a `price_entries` row
 * today, so the other 278 surface as unknown-price rows rather than as free
 * tokens — the same passthrough `canonicalModelId` was written for. Rates for
 * them are a price decision, not a parsing one.
 *
 * Nothing here writes to our database; `sync.ts` owns that.
 */

import { homedir } from "node:os";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canonicalModelId, type UsageEvent } from "@prompt-burn/core";

/** Dotted field paths, as decoded above. Read by path, so the `1.17` mirror never counts. */
const MODEL_PATH = "1.19";
const INPUT_PATH = "1.4.2";
/** Thinking + emitted text already summed by `agy`; both parts are billed as output. */
const OUTPUT_PATH = "1.4.3";
/** `steps.metadata`: epoch seconds for this step. */
const TIMESTAMP_PATH = "1.1";

/**
 * Nesting cap for the wire-walk. The deepest path we read is three levels
 * (`1.9.10.4`); six is slack, and it is what stops a pathological blob from
 * recursing without bound.
 */
const MAX_DEPTH = 6;

/**
 * Above this, a length-delimited payload that is not a submessage is treated as
 * opaque bytes rather than text. Model ids are tens of bytes; prompt and
 * response bodies are not, and must never be lifted into the decoded map.
 */
const MAX_TEXT_BYTES = 128;

/** Anything with a control, format or unassigned code point is not a model id. */
const PRINTABLE = /^[^\p{C}]+$/u;

const TEXT = new TextDecoder("utf-8", { fatal: true });

/** Where `agy` keeps one SQLite database per conversation. */
export function defaultAgyConversationsDirectory(home: string = homedir()): string {
  return join(home, ".gemini", "antigravity-cli", "conversations");
}

/** The index mapping conversations to the workspace they ran in. */
export function defaultAgySummariesPath(home: string = homedir()): string {
  return join(home, ".gemini", "antigravity-cli", "conversation_summaries.db");
}

/** A resumable read of one conversation database, mirroring `OmpFileScan`. */
export interface AgyConversationScan {
  events: UsageEvent[];
  /**
   * Generations consumed — `MAX(idx) + 1`, since `idx` is 0-based. Read the
   * same way `omp_sync_state.offset` reads for a transcript's bytes: the next
   * position to start from, not the last one taken.
   */
  offset: number;
}

/**
 * Conversation id → absolute project path, from `workspace_uris[0]`.
 *
 * The column is a JSON array of `file://` URIs; we keep the first, since a
 * conversation is opened in one workspace. A missing or unreadable index is an
 * empty map, not an error: attribution degrades to "no project", and the
 * tokens are still priced.
 */
export function readAgyProjects(
  summariesPath: string = defaultAgySummariesPath(),
): Map<string, string> {
  const projects = new Map<string, string>();
  let rows: Record<string, unknown>[];
  try {
    const db = new DatabaseSync(`file:${summariesPath}?mode=ro&immutable=1`, { readOnly: true });
    try {
      rows = db
        .prepare("SELECT conversation_id, workspace_uris FROM conversation_summaries")
        .all() as Record<string, unknown>[];
    } finally {
      db.close();
    }
  } catch {
    return projects;
  }

  for (const row of rows) {
    const id = row["conversation_id"];
    const project = firstWorkspacePath(row["workspace_uris"]);
    if (typeof id === "string" && project) projects.set(id, project);
  }
  return projects;
}

/** Every priceable generation in one conversation database. */
export function scanAgyConversation(dbPath: string, project?: string): UsageEvent[] {
  return scanAgyConversationFile(dbPath, project).events;
}

/**
 * Same read, resumed at `fromIdx` — the incremental path `sync.ts` uses.
 * `fromIdx` is inclusive and 0-based, matching the stored offset's
 * "generations already consumed" meaning.
 *
 * A database holding fewer generations than the offset claims was rebuilt
 * rather than appended to (`agy` recreates a conversation file in place), so it
 * is rescanned from the start. One that will not open, or that lacks either
 * table, yields no events: `agy` may not be installed, or may have changed its
 * schema under us, and neither is worth throwing over mid-sync.
 */
export function scanAgyConversationFile(
  dbPath: string,
  project?: string,
  fromIdx = 0,
): AgyConversationScan {
  const conversationId = basename(dbPath, ".db");
  const events: UsageEvent[] = [];

  let consumed = 0;
  let rows: Record<string, unknown>[];
  try {
    const db = new DatabaseSync(`file:${dbPath}?mode=ro&immutable=1`, { readOnly: true });
    try {
      const top = db.prepare("SELECT COUNT(*) AS rows, MAX(idx) AS top FROM gen_metadata").get();
      consumed = Number(top?.["rows"] ?? 0) > 0 ? Number(top?.["top"] ?? 0) + 1 : 0;
      rows = db
        .prepare(
          `SELECT gen_metadata.idx AS idx, gen_metadata.data AS data, steps.metadata AS metadata
             FROM gen_metadata LEFT JOIN steps ON steps.idx = gen_metadata.idx
            WHERE gen_metadata.idx >= ?
            ORDER BY gen_metadata.idx`,
        )
        .all(consumed < fromIdx ? 0 : fromIdx) as Record<string, unknown>[];
    } finally {
      db.close();
    }
  } catch {
    return { events, offset: fromIdx };
  }

  for (const row of rows) {
    const event = toUsageEvent(row, conversationId, project);
    if (event) events.push(event);
  }
  return { events, offset: consumed };
}

/**
 * One `gen_metadata` row as a `UsageEvent`, or `null` when it is not priceable:
 * no model, no input count, or no timestamp to place it in a period. Skipping
 * is the only honest option — a fabricated time would land real tokens in the
 * wrong day.
 */
function toUsageEvent(
  row: Record<string, unknown>,
  conversationId: string,
  project: string | undefined,
): UsageEvent | null {
  // SQLite hands a BLOB back as `Uint8Array`; a schema change to TEXT is not one.
  const data = row["data"];
  if (!(data instanceof Uint8Array) || data.length === 0) return null;

  const fields = decodeProtobufFields(data);
  const rawModel = fields.get(MODEL_PATH);
  const input = fields.get(INPUT_PATH);
  if (typeof rawModel !== "string" || typeof input !== "number") return null;

  const timestamp = stepTimestamp(row["metadata"]);
  if (!timestamp) return null;

  const output = fields.get(OUTPUT_PATH);
  return {
    id: `agy:${conversationId}:${Number(row["idx"])}`,
    source: "antigravity",
    timestamp,
    model: canonicalModelId(rawModel),
    rawModel,
    // cacheRead/cacheWrite stay 0 on purpose — see the cache caveat above.
    tokens: {
      input,
      output: typeof output === "number" ? output : 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    sessionId: conversationId,
    ...(project ? { project } : {}),
  };
}

/** `steps.metadata` field `1.1` as an ISO-8601 UTC string, or `undefined`. */
function stepTimestamp(metadata: unknown): string | undefined {
  if (!(metadata instanceof Uint8Array) || metadata.length === 0) return undefined;
  const seconds = decodeProtobufFields(metadata).get(TIMESTAMP_PATH);
  if (typeof seconds !== "number" || seconds <= 0) return undefined;
  const at = new Date(seconds * 1000);
  return Number.isNaN(at.getTime()) ? undefined : at.toISOString();
}

/**
 * Every scalar in an unframed protobuf message, keyed by dotted field path.
 *
 * Generic on purpose: there is no descriptor to compile, and `agy` is free to
 * add fields we have never seen. Varints become numbers, printable
 * length-delimited payloads become strings, and a length-delimited payload that
 * parses cleanly as a submessage is walked instead (so `1.4.2` is reachable
 * without knowing what `1.4` is). `fixed32`/`fixed64` are consumed so the
 * cursor stays aligned but never recorded — nothing we price is one. Groups
 * (wiretypes 3 and 4) end the walk: they are long dead and cannot be skipped
 * without a descriptor.
 *
 * It never throws. A truncated, padded or simply non-protobuf blob stops the
 * walk and returns whatever was decoded before the damage; the caller's missing
 * `1.19`/`1.4.2` then skips the row. First value wins per path, so a repeated
 * field cannot overwrite the count we already read.
 */
export function decodeProtobufFields(buffer: Uint8Array): Map<string, number | string> {
  const fields = new Map<string, number | string>();
  walk(buffer, "", fields, 0);
  return fields;
}

function walk(
  bytes: Uint8Array,
  prefix: string,
  into: Map<string, number | string>,
  depth: number,
): void {
  let at = 0;
  while (at < bytes.length) {
    const key = varint(bytes, at);
    if (!key) return;
    const field = Math.floor(key.value / 8);
    const wire = key.value % 8;
    if (field === 0) return;
    at = key.next;
    const path = prefix === "" ? String(field) : `${prefix}.${field}`;

    if (wire === 0) {
      const value = varint(bytes, at);
      if (!value) return;
      if (!into.has(path)) into.set(path, value.value);
      at = value.next;
      continue;
    }
    if (wire === 1 || wire === 5) {
      at += wire === 1 ? 8 : 4;
      if (at > bytes.length) return;
      continue;
    }
    if (wire !== 2) return;

    const length = varint(bytes, at);
    if (!length) return;
    const end = length.next + length.value;
    if (end > bytes.length) return;
    const payload = bytes.subarray(length.next, end);
    if (depth < MAX_DEPTH && isMessage(payload)) {
      walk(payload, path, into, depth + 1);
    } else {
      const text = asText(payload);
      if (text !== undefined && !into.has(path)) into.set(path, text);
    }
    at = end;
  }
}

/**
 * Whether `bytes` is a submessage rather than a payload. Strict by design: every
 * field must carry a known wiretype and a length that fits, and the fields must
 * consume the payload exactly. A model id like `gemini-3.8-flash` fails on its
 * first byte (`0x67` is wiretype 7), which is what keeps it a string.
 */
function isMessage(bytes: Uint8Array): boolean {
  let at = 0;
  let seen = 0;
  while (at < bytes.length) {
    const key = varint(bytes, at);
    if (!key) return false;
    const wire = key.value % 8;
    if (Math.floor(key.value / 8) === 0) return false;
    at = key.next;
    if (wire === 0) {
      const value = varint(bytes, at);
      if (!value) return false;
      at = value.next;
    } else if (wire === 1) {
      at += 8;
    } else if (wire === 5) {
      at += 4;
    } else if (wire === 2) {
      const length = varint(bytes, at);
      if (!length) return false;
      at = length.next + length.value;
    } else {
      return false;
    }
    if (at > bytes.length) return false;
    seen += 1;
  }
  return seen > 0;
}

/** A short, printable, valid-UTF-8 payload as text. Anything else is opaque. */
function asText(payload: Uint8Array): string | undefined {
  if (payload.length === 0 || payload.length > MAX_TEXT_BYTES) return undefined;
  let text: string;
  try {
    text = TEXT.decode(payload);
  } catch {
    return undefined;
  }
  return PRINTABLE.test(text) ? text : undefined;
}

/**
 * One base-128 varint. Ten bytes is protobuf's maximum; past 2^53 the value is
 * approximate, which is irrelevant for token counts and timestamps and beats
 * carrying BigInt through the walk.
 */
function varint(bytes: Uint8Array, at: number): { value: number; next: number } | undefined {
  let value = 0;
  let shift = 1;
  for (let i = at; i < bytes.length && i < at + 10; i += 1) {
    const byte = bytes[i] as number;
    value += (byte & 0x7f) * shift;
    if ((byte & 0x80) === 0) return { value, next: i + 1 };
    shift *= 128;
  }
  return undefined;
}

/** `["file:///Users/me/work"]` → `/Users/me/work`. Percent escapes are decoded. */
function firstWorkspacePath(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  let uris: unknown;
  try {
    uris = JSON.parse(value);
  } catch {
    return undefined;
  }
  const first = Array.isArray(uris) ? uris[0] : undefined;
  if (typeof first !== "string" || !first.startsWith("file://")) return undefined;
  const path = first.slice("file://".length);
  try {
    return decodeURIComponent(path) || undefined;
  } catch {
    return path || undefined;
  }
}
