/**
 * The `agy` collector against synthetic conversation databases.
 *
 * Every fixture here is built byte by byte by the little encoder below, because
 * a real conversation database contains the user's prompts and must never enter
 * this repository. The encoder writes the same wire shape the decoder was
 * derived from, so what the tests pin is the field map, not a captured blob.
 *
 * The behaviours that earn a test are the ones where a plausible bug quietly
 * changes money or a date:
 *
 * - The field map itself. `1.4.2`/`1.4.3`/`1.19` are positions in an undescribed
 *   protobuf; a decoder that walks one level differently reads someone else's
 *   number as tokens.
 * - The `1.17.2.*` mirror. It repeats `1.4.*` verbatim, so a walk that flattened
 *   paths — or summed by field number — would bill every generation twice.
 * - `1.4.3` taken whole. It equals `1.4.9 + 1.4.10` (thinking plus emitted
 *   text); adding those on top of it is the obvious way to double the output
 *   charge, and Google bills thinking at the output rate either way.
 * - `1.4.5` left alone. It is unidentified and larger than the prompt on early
 *   rows, so pricing it would invent cost out of an unknown field.
 * - Rows with no model and rows with no step timestamp. Both must drop out: an
 *   unknown model prices at nothing useful, and a fabricated "now" lands real
 *   tokens in the wrong day.
 * - Resume bookkeeping. `idx` is 0-based, so an off-by-one in the offset either
 *   loses the first generation of every conversation or re-reads the whole file
 *   on every fetch.
 * - Files that are not databases. `agy`'s directory is not ours; a stray file
 *   must not abort a sync that has already collected real rows.
 */

import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { databasePath, openDatabase } from "@prompt-burn/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decodeProtobufFields,
  defaultAgyConversationsDirectory,
  defaultAgySummariesPath,
  readAgyProjects,
  scanAgyConversation,
  syncAntigravityConversations,
} from "./index.js";

const CONVERSATION = "d2a5efbb-1111-4222-8333-444455556666";
/** 2026-09-11T10:10:31Z and two seconds later, as `steps.metadata` stores them. */
const AT = 1_789_121_431;
const LATER = 1_789_121_433;

/** One `gen_metadata` row's worth of intent. Absent keys are absent fields. */
interface GenRow {
  model?: string;
  input?: number;
  output?: number;
  /** `1.4.9` — thinking tokens, already inside `output`. */
  thinking?: number;
  /** `1.4.10` — emitted text, already inside `output`. */
  emitted?: number;
  /** Epoch seconds for the matching `steps` row; omitted writes no step. */
  at?: number;
}

const CREATE = `
  CREATE TABLE IF NOT EXISTS gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER);
  CREATE TABLE IF NOT EXISTS steps (idx INTEGER PRIMARY KEY, metadata BLOB, step_payload BLOB)`;

let root: string;
let conversations: string;
let summaries: string;
let db: DatabaseSync;
/** Monotonic mtime source: SQLite writes can land in the same millisecond. */
let clock: number;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prompt-burn-agy-cli-"));
  conversations = join(root, "conversations");
  summaries = join(root, "conversation_summaries.db");
  mkdirSync(conversations, { recursive: true });
  db = openDatabase(databasePath(root));
  clock = Date.now();
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

/** Base-128 varint, the one primitive everything else here is made of. */
function varint(value: number): number[] {
  const bytes: number[] = [];
  let rest = value;
  do {
    const byte = rest % 128;
    rest = Math.floor(rest / 128);
    bytes.push(rest > 0 ? byte | 0x80 : byte);
  } while (rest > 0);
  return bytes;
}

function num(field: number, value: number): number[] {
  return [...varint(field * 8), ...varint(value)];
}

function text(field: number, value: string): number[] {
  const body = [...Buffer.from(value, "utf8")];
  return [...varint(field * 8 + 2), ...varint(body.length), ...body];
}

function sub(field: number, body: number[]): number[] {
  return [...varint(field * 8 + 2), ...varint(body.length), ...body];
}

/**
 * One generation blob: an unframed message whose field 1 carries the counts at
 * `4`, the model id at `19`, and the `17` mirror of the counts that must never
 * be added to them.
 */
function generation(row: GenRow): Uint8Array {
  const counts = [
    ...(row.input === undefined ? [] : num(2, row.input)),
    ...(row.output === undefined ? [] : num(3, row.output)),
    // 1.4.5 — unidentified, bigger than the prompt, never priced.
    ...num(5, 259_867),
    ...(row.thinking === undefined ? [] : num(9, row.thinking)),
    ...(row.emitted === undefined ? [] : num(10, row.emitted)),
  ];
  return Uint8Array.from(
    sub(1, [
      ...sub(4, counts),
      ...(row.model === undefined ? [] : text(19, row.model)),
      ...sub(17, sub(2, counts)),
      // 1.9.10.4 — the context window, as the real blob reports it.
      ...sub(9, sub(10, num(4, 256_000))),
    ]),
  );
}

/** `steps.metadata`: the step's epoch-seconds timestamp at `1.1`. */
function step(seconds: number): Uint8Array {
  return Uint8Array.from(sub(1, num(1, seconds)));
}

/** Writes (or appends to) a conversation database and gives it a fresh mtime. */
function writeConversation(conversationId: string, rows: GenRow[], fromIdx = 0): string {
  const path = join(conversations, `${conversationId}.db`);
  const file = new DatabaseSync(path);
  file.exec(CREATE);
  const insertGen = file.prepare("INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)");
  const insertStep = file.prepare("INSERT INTO steps (idx, metadata, step_payload) VALUES (?, ?, ?)");
  rows.forEach((row, offset) => {
    const blob = generation(row);
    insertGen.run(fromIdx + offset, blob, blob.length);
    if (row.at !== undefined) insertStep.run(fromIdx + offset, step(row.at), null);
  });
  file.close();
  clock += 2_000;
  utimesSync(path, new Date(clock), new Date(clock));
  return path;
}

/** `agy`'s conversation index, with whatever `workspace_uris` the test needs. */
function writeSummaries(entries: Array<[string, string]>): void {
  const file = new DatabaseSync(summaries);
  file.exec(`CREATE TABLE conversation_summaries (
    conversation_id TEXT PRIMARY KEY, workspace_uris TEXT,
    last_modified_time INTEGER, app_data_dir TEXT)`);
  const insert = file.prepare(
    `INSERT INTO conversation_summaries
       (conversation_id, workspace_uris, last_modified_time, app_data_dir)
     VALUES (?, ?, 0, 'antigravity-cli')`,
  );
  for (const [id, uris] of entries) insert.run(id, uris);
  file.close();
}

function rows(): Array<Record<string, unknown>> {
  return db.prepare("SELECT * FROM usage_events ORDER BY id").all();
}

describe("default paths", () => {
  it("points at agy's own directory layout", () => {
    expect(defaultAgyConversationsDirectory("/home/me")).toBe(
      "/home/me/.gemini/antigravity-cli/conversations",
    );
    expect(defaultAgySummariesPath("/home/me")).toBe(
      "/home/me/.gemini/antigravity-cli/conversation_summaries.db",
    );
  });
});

describe("decodeProtobufFields", () => {
  it("keys every scalar by dotted path, model string included", () => {
    const fields = decodeProtobufFields(
      generation({ model: "gemini-3.8-flash", input: 257_827, output: 900 }),
    );

    expect(fields.get("1.19")).toBe("gemini-3.8-flash");
    expect(fields.get("1.4.2")).toBe(257_827);
    expect(fields.get("1.4.3")).toBe(900);
    expect(fields.get("1.9.10.4")).toBe(256_000);
  });

  it("keeps the 1.17 mirror under its own path instead of merging it", () => {
    const fields = decodeProtobufFields(generation({ model: "m", input: 100, output: 20 }));

    // Same numbers, different keys: nothing reads these, so nothing doubles.
    expect(fields.get("1.17.2.2")).toBe(100);
    expect(fields.get("1.4.2")).toBe(100);
  });

  it("returns what it decoded instead of throwing on a damaged blob", () => {
    const whole = generation({ model: "gemini-3.8-flash", input: 100, output: 20 });

    expect(() => decodeProtobufFields(whole.subarray(0, 6))).not.toThrow();
    expect(decodeProtobufFields(Uint8Array.from([0xff, 0xff, 0xff])).size).toBe(0);
    expect(decodeProtobufFields(Buffer.from("not protobuf at all")).size).toBe(0);
  });
});

describe("scanAgyConversation", () => {
  it("prices one generation from the documented field map", () => {
    const path = writeConversation(CONVERSATION, [
      { model: "gemini-3.8-flash", input: 12_345, output: 678, at: AT },
    ]);

    expect(scanAgyConversation(path, "/Users/example/project")).toEqual([
      {
        id: `agy:${CONVERSATION}:0`,
        source: "antigravity",
        timestamp: "2026-09-11T10:10:31.000Z",
        model: "gemini-3.8-flash",
        rawModel: "gemini-3.8-flash",
        // 1.4.5 is 259,867 in every fixture row and appears nowhere here.
        tokens: { input: 12_345, output: 678, cacheRead: 0, cacheWrite: 0 },
        sessionId: CONVERSATION,
        project: "/Users/example/project",
      },
    ]);
  });

  it("takes 1.4.3 whole rather than summing thinking and emitted text", () => {
    const path = writeConversation(CONVERSATION, [
      { model: "gemini-3.8-flash", input: 10, output: 700, thinking: 500, emitted: 200, at: AT },
    ]);

    // 700, not 1,400: the parts are already inside the total Google bills.
    expect(scanAgyConversation(path)[0]?.tokens.output).toBe(700);
  });

  it("skips a generation with no model instead of pricing an unknown one", () => {
    const path = writeConversation(CONVERSATION, [
      { input: 500, output: 10, at: AT },
      { model: "gemini-3.8-flash", input: 600, output: 20, at: LATER },
    ]);

    const events = scanAgyConversation(path);
    expect(events.map((event) => event.id)).toEqual([`agy:${CONVERSATION}:1`]);
    expect(events[0]?.model).toBe("gemini-3.8-flash");
  });

  it("skips a generation with no input count", () => {
    const path = writeConversation(CONVERSATION, [
      { model: "gemini-3.8-flash", output: 10, at: AT },
    ]);

    expect(scanAgyConversation(path)).toEqual([]);
  });

  it("skips a generation whose step timestamp is missing rather than inventing one", () => {
    const path = writeConversation(CONVERSATION, [
      { model: "gemini-3.8-flash", input: 500, output: 10 },
      { model: "gemini-3.8-flash", input: 600, output: 20, at: LATER },
    ]);

    expect(scanAgyConversation(path).map((event) => event.timestamp)).toEqual([
      "2026-09-11T10:10:33.000Z",
    ]);
  });

  it("reads a file that is not a database, or lacks a table, as no usage", () => {
    const stray = join(conversations, "notes.db");
    writeFileSync(stray, "this is not sqlite\n");
    const halfBuilt = join(conversations, "half.db");
    const file = new DatabaseSync(halfBuilt);
    file.exec("CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER)");
    file.close();

    expect(scanAgyConversation(stray)).toEqual([]);
    expect(scanAgyConversation(halfBuilt)).toEqual([]);
    expect(scanAgyConversation(join(conversations, "absent.db"))).toEqual([]);
  });
});

describe("readAgyProjects", () => {
  it("turns workspace_uris into an absolute path", () => {
    writeSummaries([
      [CONVERSATION, JSON.stringify(["file:///Users/example/my%20project"])],
      ["second", JSON.stringify(["file:///Users/example/other", "file:///ignored"])],
      ["no-workspace", "[]"],
      ["not-json", "{oops"],
    ]);

    const projects = readAgyProjects(summaries);
    expect(projects.get(CONVERSATION)).toBe("/Users/example/my project");
    expect(projects.get("second")).toBe("/Users/example/other");
    expect(projects.has("no-workspace")).toBe(false);
    expect(projects.has("not-json")).toBe(false);
  });

  it("reads a missing index as no attribution at all", () => {
    expect(readAgyProjects(join(root, "absent.db")).size).toBe(0);
  });
});

describe("syncAntigravityConversations", () => {
  it("stores generations as antigravity events attributed to their workspace", () => {
    writeSummaries([[CONVERSATION, JSON.stringify(["file:///Users/example/project"])]]);
    writeConversation(CONVERSATION, [
      { model: "gemini-3.8-flash", input: 1_000, output: 100, at: AT },
      { model: "gemini-3.8-flash", input: 2_000, output: 200, at: LATER },
    ]);

    expect(syncAntigravityConversations(db, conversations, summaries)).toEqual({
      scannedFiles: 1,
      skippedFiles: 0,
      insertedEvents: 2,
    });
    expect(rows()).toEqual([
      {
        id: `agy:${CONVERSATION}:0`,
        source: "antigravity",
        period: "event",
        timestamp: "2026-09-11T10:10:31.000Z",
        model: "gemini-3.8-flash",
        raw_model: "gemini-3.8-flash",
        input: 1_000,
        output: 100,
        cache_read: 0,
        cache_write: 0,
        session_id: CONVERSATION,
        project: "/Users/example/project",
      },
      {
        id: `agy:${CONVERSATION}:1`,
        source: "antigravity",
        period: "event",
        timestamp: "2026-09-11T10:10:33.000Z",
        model: "gemini-3.8-flash",
        raw_model: "gemini-3.8-flash",
        input: 2_000,
        output: 200,
        cache_read: 0,
        cache_write: 0,
        session_id: CONVERSATION,
        project: "/Users/example/project",
      },
    ]);
  });

  it("skips an unchanged conversation on the second run", () => {
    writeConversation(CONVERSATION, [{ model: "gemini-3.8-flash", input: 10, output: 1, at: AT }]);
    syncAntigravityConversations(db, conversations, summaries);

    expect(syncAntigravityConversations(db, conversations, summaries)).toEqual({
      scannedFiles: 0,
      skippedFiles: 1,
      insertedEvents: 0,
    });
    expect(rows()).toHaveLength(1);
  });

  it("inserts only the new generations of a conversation that grew", () => {
    writeConversation(CONVERSATION, [{ model: "gemini-3.8-flash", input: 10, output: 1, at: AT }]);
    syncAntigravityConversations(db, conversations, summaries);
    writeConversation(
      CONVERSATION,
      [{ model: "gemini-3.8-flash", input: 20, output: 2, at: LATER }],
      1,
    );

    expect(syncAntigravityConversations(db, conversations, summaries)).toEqual({
      scannedFiles: 1,
      skippedFiles: 0,
      insertedEvents: 1,
    });
    expect(rows().map((row) => row["id"])).toEqual([
      `agy:${CONVERSATION}:0`,
      `agy:${CONVERSATION}:1`,
    ]);
  });

  it("rescans from the start when a conversation was rebuilt smaller", () => {
    writeConversation(CONVERSATION, [
      { model: "gemini-3.8-flash", input: 10, output: 1, at: AT },
      { model: "gemini-3.8-flash", input: 20, output: 2, at: LATER },
    ]);
    syncAntigravityConversations(db, conversations, summaries);
    db.exec("DELETE FROM usage_events");
    rmSync(join(conversations, `${CONVERSATION}.db`));
    writeConversation(CONVERSATION, [
      { model: "gemini-3.8-flash", input: 30, output: 3, at: AT },
    ]);

    expect(syncAntigravityConversations(db, conversations, summaries).insertedEvents).toBe(1);
    expect(rows()[0]?.["input"]).toBe(30);
  });

  it("walks past a file that is not a database", () => {
    writeFileSync(join(conversations, "stray.db"), "not sqlite\n");
    writeConversation(CONVERSATION, [{ model: "gemini-3.8-flash", input: 10, output: 1, at: AT }]);

    expect(syncAntigravityConversations(db, conversations, summaries).insertedEvents).toBe(1);
  });

  it("reads a missing conversations directory as nothing to do", () => {
    expect(syncAntigravityConversations(db, join(root, "absent"), summaries)).toEqual({
      scannedFiles: 0,
      skippedFiles: 0,
      insertedEvents: 0,
    });
  });
});
