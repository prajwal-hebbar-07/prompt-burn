/**
 * Settings round-trip through the real file: written, closed, reopened. That
 * reopen is the point — the desktop window and the VS Code tab are two
 * processes over one `db.sqlite`, so a value only counts if it survives the
 * handle that wrote it.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DEFAULT_SETTINGS, databasePath, openDatabase, readSettings, writeSettings } from "./index.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "prompt-burn-settings-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

it("defaults to both sources on and no path override", () => {
  const db = openDatabase(databasePath(home));

  expect(readSettings(db)).toEqual(DEFAULT_SETTINGS);
  expect(DEFAULT_SETTINGS).toEqual({ ompEnabled: true, ompPath: "", cursorEnabled: true });
  db.close();
});

it("keeps the path and the toggles across a reopen", () => {
  const first = openDatabase(databasePath(home));
  writeSettings(first, { ompPath: "/tmp/omp-sessions", cursorEnabled: false });
  first.close();

  const second = openDatabase(databasePath(home));
  expect(readSettings(second)).toEqual({
    ompEnabled: true,
    ompPath: "/tmp/omp-sessions",
    cursorEnabled: false,
  });
  second.close();
});

it("updates a key in place instead of stacking rows", () => {
  const db = openDatabase(databasePath(home));

  writeSettings(db, { ompEnabled: false });
  writeSettings(db, { ompEnabled: true });

  const { rows } = db
    .prepare("SELECT count(*) AS rows FROM settings WHERE key = 'omp_enabled'")
    .get() as { rows: number };
  expect(rows).toBe(1);
  expect(readSettings(db).ompEnabled).toBe(true);
  db.close();
});

it("leaves keys the patch does not mention alone", () => {
  const db = openDatabase(databasePath(home));

  writeSettings(db, { ompPath: "/tmp/omp-sessions", ompEnabled: false });
  writeSettings(db, { cursorEnabled: false });

  expect(readSettings(db)).toEqual({
    ompEnabled: false,
    ompPath: "/tmp/omp-sessions",
    cursorEnabled: false,
  });
  db.close();
});
