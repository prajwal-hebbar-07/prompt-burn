/**
 * `createUsageReader` over both sources, in-process and offline: injected OMP
 * directory, injected synthetic `state.vscdb`, injected `fetch` serving the
 * spike fixtures. No real Cursor install, no live API, no real `~/.prompt-burn`.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { databasePath, openDatabase } from "@prompt-burn/db";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createUsageReader } from "./index.js";

const FIXTURE_LINE = readFileSync(
  new URL("../../../docs/fixtures/omp-session-line.json", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const SUMMARY = readFileSync(
  new URL("../../../docs/fixtures/cursor-usage-summary.json", import.meta.url),
  "utf8",
);
const AGGREGATES = readFileSync(
  new URL("../../../docs/fixtures/cursor-cycle-aggregates.json", import.meta.url),
  "utf8",
);

const HEADER = JSON.stringify({
  type: "session",
  version: 3,
  id: "01a06111-2b47-75b9-9bd1-acfc5358378f",
  timestamp: "2026-09-02T07:41:50.279Z",
  cwd: "/Users/example/project",
});

/** An unsigned JWT with the two claims the auth read looks at. */
const FAKE_JWT = [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(
    JSON.stringify({ sub: "user_01SYNTHETIC", exp: Math.floor(Date.now() / 1000) + 86_400 }),
  ).toString("base64url"),
  "not-a-signature",
].join(".");

const NOW = new Date("2026-09-02T10:00:00.000Z");
/** Every fixture `inputTokens` added up, cycle-wide. */
const CYCLE_INPUT = 13_006_167;

let root: string;
let sessions: string;
let statePath: string;
let db: DatabaseSync;
/** Flipped by a test to make the Cursor call fail mid-session. */
let status: number;

/** A reader whose Cursor HTTP answers from the fixtures with `status`. */
function reader(cursorStatePath = statePath) {
  return createUsageReader(db, {
    ompDirectory: sessions,
    cursorStatePath,
    fetchImpl: (async (url: string | URL | Request) =>
      new Response(String(url).endsWith("/api/usage-summary") ? SUMMARY : AGGREGATES, {
        status,
      })) as unknown as typeof fetch,
    now: () => NOW,
  });
}

beforeEach(() => {
  status = 200;
  root = mkdtempSync(join(tmpdir(), "prompt-burn-reader-sources-"));
  sessions = join(root, "omp-sessions");
  mkdirSync(join(sessions, "proj"), { recursive: true });
  writeFileSync(join(sessions, "proj", "20260902_074150_abc.jsonl"), `${HEADER}\n${FIXTURE_LINE}\n`);

  statePath = join(root, "state.vscdb");
  const state = new DatabaseSync(statePath);
  state.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
  state
    .prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)")
    .run("cursorAuth/accessToken", FAKE_JWT);
  state.close();

  db = openDatabase(databasePath(root));
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

it("aggregates both sources after a dual-success fetch", async () => {
  const host = reader();
  const result = await host.fetch();

  expect(result).toMatchObject({
    ok: true,
    omp: { ok: true, scannedFiles: 1, insertedEvents: 1 },
    cursor: { ok: true, models: 6 },
  });
  expect(result.error).toBeUndefined();

  const snapshot = await host.getSnapshot({ kind: "all_time" });
  expect(snapshot.omp.tokens.input).toBe(2);
  expect(snapshot.cursor).toMatchObject({
    mode: "cycle_aggregate",
    cycleLabel: "Cycle to date",
    cycleStart: "2026-08-26T07:25:29.000Z",
    cycleEnd: "2026-09-26T07:25:29.000Z",
    tokens: { input: CYCLE_INPUT },
  });
  const sources = snapshot.models.map((row) => row.source);
  expect(sources).toContain("omp");
  expect(sources).toContain("cursor");
});

it("marks a calendar period mixed once Cursor data is in the snapshot", async () => {
  const host = reader();
  await host.fetch();

  expect((await host.getSnapshot({ kind: "this_month" })).mixedPeriod).toBe(true);
  expect((await host.getSnapshot({ kind: "all_time" })).mixedPeriod).toBe(false);
});

it("keeps the last Cursor cycle when a later fetch fails", async () => {
  const host = reader();
  await host.fetch();

  status = 503;
  const result = await host.fetch();
  expect(result).toMatchObject({ ok: false, cursor: { ok: false, reason: "fetch_failed" } });
  expect(result.error).toContain("Cursor failed");
  // The OMP half of the same pass still succeeded.
  expect(result.omp.ok).toBe(true);

  const kept = await host.getSnapshot({ kind: "all_time" });
  expect(kept.cursor.tokens.input).toBe(CYCLE_INPUT);
});

it("degrades Cursor without failing the pass when there is no local session", async () => {
  const host = reader(join(root, "absent", "state.vscdb"));

  expect(await host.discover()).toEqual([
    { source: "omp", available: true, detail: sessions },
    { source: "cursor", available: false, detail: expect.stringContaining("No Cursor state at") },
  ]);

  const result = await host.fetch();
  expect(result).toMatchObject({
    ok: true,
    omp: { ok: true, insertedEvents: 1 },
    cursor: { ok: false, reason: "not_installed", models: 0 },
  });
  expect(result.error).toBeUndefined();

  const snapshot = await host.getSnapshot({ kind: "all_time" });
  expect(snapshot.cursor.tokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  expect(snapshot.omp.tokens.input).toBe(2);
});

it("reports the Cursor state path, never the token, from discover", async () => {
  const health = await reader().discover();

  expect(health[1]).toEqual({ source: "cursor", available: true, detail: statePath });
  expect(JSON.stringify(health)).not.toContain(FAKE_JWT);
});
