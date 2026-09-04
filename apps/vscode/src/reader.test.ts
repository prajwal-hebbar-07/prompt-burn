/**
 * `createHostReader` end to end without an editor: injected home, injected OMP
 * sessions directory, a Cursor state path that does not exist. No real
 * `~/.prompt-burn`, no real `~/.omp`, no Cursor install, no HTTP — the Cursor
 * pass degrades before it would need a token, so nothing here handles one.
 *
 * The reader's own behaviour is covered in `@prompt-burn/reader`; what this
 * checks is the wiring: the shared database file, and that both sources reach
 * the snapshot through it.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { databasePath } from "@prompt-burn/db";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createHostReader } from "./reader.js";

// Vitest runs from this package's root (`pnpm --filter … test`).
const FIXTURE_LINE = readFileSync(
  "../../docs/fixtures/omp-session-line.json",
  "utf8",
).replace(/\s+/g, " ");

const HEADER = JSON.stringify({
  type: "session",
  version: 3,
  id: "01a06111-2b47-75b9-9bd1-acfc5358378f",
  timestamp: "2026-09-02T07:41:50.279Z",
  cwd: "/Users/example/project",
});

let root: string;
let home: string;
let sessions: string;

/** A host reader whose Cursor side has nothing to read. */
function hostReader() {
  return createHostReader({
    home,
    ompDirectory: sessions,
    cursorStatePath: join(root, "absent", "state.vscdb"),
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prompt-burn-vscode-"));
  home = join(root, "home");
  sessions = join(root, "sessions");
  mkdirSync(sessions, { recursive: true });
  writeFileSync(join(sessions, "session.jsonl"), `${HEADER}\n${FIXTURE_LINE}\n`);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

it("reads and aggregates through the shared database file", async () => {
  const reader = hostReader();

  const fetched = await reader.fetch();
  expect(fetched.omp).toMatchObject({ ok: true, insertedEvents: 1 });
  // Cursor has no local session here: degraded, not a failed pass.
  expect(fetched.ok).toBe(true);
  expect(fetched.cursor.ok).toBe(false);

  const snapshot = await reader.getSnapshot({ kind: "all_time" });
  expect(snapshot.omp.tokens.input).toBeGreaterThan(0);
  expect(snapshot.models.map((row) => row.source)).toEqual(["omp"]);
  // Nothing from Cursor, and no faked cycle window standing in for it.
  expect(snapshot.cursor.tokens.input).toBe(0);
  expect(snapshot.cursor.cycleStart).toBe("");

  // The same path the desktop sidecar opens, under the injected home only.
  expect(readFileSync(databasePath(home)).byteLength).toBeGreaterThan(0);
});

it("reports where each source lives, never a token, from discover", async () => {
  const health = await hostReader().discover();

  expect(health.find((entry) => entry.source === "omp")).toEqual({
    source: "omp",
    available: true,
    detail: sessions,
  });
  const cursor = health.find((entry) => entry.source === "cursor");
  expect(cursor?.available).toBe(false);
  expect(cursor?.detail).toBe(`No Cursor state at ${join(root, "absent", "state.vscdb")}`);
});
