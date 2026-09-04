/**
 * Incremental sync, driven by synthetic transcripts built from the spike
 * fixture. Neither a real `~/.omp` nor a real `~/.prompt-burn` is touched.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { databasePath, openDatabase } from "@prompt-burn/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncOmpSessions } from "./index.js";

const FIXTURE_LINE = readFileSync(
  new URL("../../../docs/fixtures/omp-session-line.json", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");

const SESSION_ID = "01a06111-2b47-75b9-9bd1-acfc5358378f";

const HEADER = JSON.stringify({
  type: "session",
  version: 3,
  id: SESSION_ID,
  timestamp: "2026-09-02T07:41:50.279Z",
  cwd: "/Users/example/project",
});

/** The fixture message with a different per-file line id. */
function messageLine(id: string): string {
  return FIXTURE_LINE.replace('"566d37c8"', JSON.stringify(id));
}

let root: string;
let sessions: string;
let db: DatabaseSync;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prompt-burn-sync-"));
  sessions = join(root, "omp-sessions");
  mkdirSync(sessions, { recursive: true });
  db = openDatabase(databasePath(root));
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

function writeTranscript(relativePath: string, lines: string[]): string {
  const path = join(sessions, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

function appendLines(path: string, lines: string[]): void {
  writeFileSync(path, `${lines.join("\n")}\n`, { flag: "a" });
  // Force a distinct mtime even if the append lands in the same millisecond.
  const later = new Date(Date.now() + 2000);
  utimesSync(path, later, later);
}

function rows(): Array<Record<string, unknown>> {
  return db.prepare("SELECT * FROM usage_events ORDER BY id").all();
}

describe("syncOmpSessions", () => {
  it("stores tokens, timestamp and model as event rows", () => {
    writeTranscript("proj/20260902_074150_abc.jsonl", [HEADER, FIXTURE_LINE]);

    expect(syncOmpSessions(db, sessions)).toEqual({
      scannedFiles: 1,
      skippedFiles: 0,
      insertedEvents: 1,
    });
    expect(rows()).toEqual([
      {
        id: `omp:${SESSION_ID}:566d37c8`,
        source: "omp",
        period: "event",
        timestamp: "2026-09-02T08:31:31.505Z",
        model: "claude-opus-5",
        raw_model: "claude-opus-5",
        input: 2,
        output: 105,
        cache_read: 37378,
        cache_write: 463,
        session_id: SESSION_ID,
      },
    ]);
  });

  it("skips unchanged files on the second sync", () => {
    writeTranscript("proj/a.jsonl", [HEADER, FIXTURE_LINE]);
    writeTranscript("proj/a/Commit-5.jsonl", [
      HEADER.replace(SESSION_ID, "22222222-3333-4444-5555-666666666666"),
      FIXTURE_LINE,
    ]);

    expect(syncOmpSessions(db, sessions)).toMatchObject({ scannedFiles: 2, insertedEvents: 2 });

    // Nothing changed on disk: no file is opened, no row is written.
    expect(syncOmpSessions(db, sessions)).toEqual({
      scannedFiles: 0,
      skippedFiles: 2,
      insertedEvents: 0,
    });
    expect(rows()).toHaveLength(2);

    const state = db.prepare("SELECT path, mtime, offset FROM omp_sync_state ORDER BY path").all();
    expect(state).toHaveLength(2);
    expect(Number(state[0]?.["offset"])).toBeGreaterThan(0);
  });

  it("resumes an appended file from its offset without duplicating rows", () => {
    const path = writeTranscript("proj/live.jsonl", [HEADER, messageLine("aaaa0001")]);
    syncOmpSessions(db, sessions);

    appendLines(path, [messageLine("bbbb0002"), messageLine("cccc0003")]);

    expect(syncOmpSessions(db, sessions)).toEqual({
      scannedFiles: 1,
      skippedFiles: 0,
      // Only the two new lines are parsed; the first is behind the offset.
      insertedEvents: 2,
    });
    expect(rows().map((row) => row["id"])).toEqual([
      `omp:${SESSION_ID}:aaaa0001`,
      `omp:${SESSION_ID}:bbbb0002`,
      `omp:${SESSION_ID}:cccc0003`,
    ]);
  });

  it("re-reads a rewritten file without duplicating its rows", () => {
    const path = writeTranscript("proj/rewritten.jsonl", [
      HEADER,
      messageLine("aaaa0001"),
      messageLine("bbbb0002"),
    ]);
    syncOmpSessions(db, sessions);

    // Truncated and rewritten shorter: the stored offset is now past the end.
    writeFileSync(path, `${[HEADER, messageLine("aaaa0001")].join("\n")}\n`);
    const later = new Date(Date.now() + 2000);
    utimesSync(path, later, later);

    expect(syncOmpSessions(db, sessions)).toMatchObject({ scannedFiles: 1, insertedEvents: 0 });
    // The id is the primary key, so the replay is a no-op, not a duplicate.
    expect(rows()).toHaveLength(2);
  });

  it("does not duplicate an id that two files somehow share", () => {
    writeTranscript("proj/one.jsonl", [HEADER, FIXTURE_LINE]);
    writeTranscript("proj/two.jsonl", [HEADER, FIXTURE_LINE]);

    expect(syncOmpSessions(db, sessions)).toMatchObject({ scannedFiles: 2, insertedEvents: 1 });
    expect(rows()).toHaveLength(1);
  });

  it("leaves a torn final line for the next sync", () => {
    const path = join(sessions, "proj", "torn.jsonl");
    mkdirSync(join(sessions, "proj"), { recursive: true });
    writeFileSync(path, `${HEADER}\n${messageLine("aaaa0001")}\n{"type":"message","id":"bb`);

    expect(syncOmpSessions(db, sessions)).toMatchObject({ insertedEvents: 1 });
    // The offset stops before the half-written line, so nothing is lost.
    const offset = Number(db.prepare("SELECT offset FROM omp_sync_state").get()?.["offset"]);
    expect(offset).toBeLessThan(Buffer.byteLength(readFileSync(path, "utf8")));

    // OMP finishes writing that line.
    writeFileSync(
      path,
      `${HEADER}\n${messageLine("aaaa0001")}\n${messageLine("bbbb0002")}\n`,
    );
    const later = new Date(Date.now() + 2000);
    utimesSync(path, later, later);

    expect(syncOmpSessions(db, sessions)).toMatchObject({ insertedEvents: 1 });
    expect(rows()).toHaveLength(2);
  });

  it("does nothing when OMP has never run here", () => {
    expect(syncOmpSessions(db, join(root, "nope"))).toEqual({
      scannedFiles: 0,
      skippedFiles: 0,
      insertedEvents: 0,
    });
  });
});
