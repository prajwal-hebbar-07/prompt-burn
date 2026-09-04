/**
 * `createUsageReader` over both sources, in-process and offline: injected OMP
 * directory, injected synthetic `state.vscdb`, injected `fetch` serving the
 * spike fixtures. No real Cursor install, no live API, no real `~/.prompt-burn`.
 *
 * The settings cases use the reader's own `saveSettings` / `addPrice`, which is
 * the path both shells drive, so a stored path or toggle is proved through the
 * same code the UI reaches.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { databasePath, openDatabase, readSettings } from "@prompt-burn/db";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createUsageReader, type DashboardSnapshot } from "./index.js";

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

it("fetches through the stored OMP path and reports it from discover", async () => {
  // No injected directory: the stored setting is the only thing pointing at it.
  const host = createUsageReader(db, { cursorStatePath: join(root, "absent"), now: () => NOW });
  await host.saveSettings({ ompPath: sessions });

  expect(await host.getSettings()).toEqual({
    ompEnabled: true,
    ompPath: sessions,
    cursorEnabled: true,
  });
  expect((await host.discover())[0]).toEqual({
    source: "omp",
    available: true,
    detail: sessions,
  });
  expect(await host.fetch()).toMatchObject({ omp: { ok: true, insertedEvents: 1 } });
});

it("does not fetch a source the settings switched off", async () => {
  const calls: string[] = [];
  const host = createUsageReader(db, {
    ompDirectory: sessions,
    cursorStatePath: statePath,
    fetchImpl: (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(AGGREGATES, { status: 200 });
    }) as unknown as typeof fetch,
    now: () => NOW,
  });
  await host.saveSettings({ ompEnabled: false, cursorEnabled: false });

  const result = await host.fetch();
  // Neither source ran, and neither counts as a failure: the pass is clean.
  expect(result).toMatchObject({
    ok: true,
    omp: { ok: true, scannedFiles: 0, insertedEvents: 0 },
    cursor: { ok: false, reason: "disabled", models: 0 },
  });
  expect(result.error).toBeUndefined();
  expect(calls).toEqual([]);
  expect((await host.getSnapshot({ kind: "all_time" })).omp.tokens.input).toBe(0);
  expect(await host.discover()).toEqual([
    { source: "omp", available: false, detail: "Disabled in Settings" },
    { source: "cursor", available: false, detail: "Disabled in Settings" },
  ]);
});

it("never persists a Cursor token or a crsr_ key while saving settings", async () => {
  const host = reader();
  await host.fetch();
  await host.saveSettings({ ompPath: sessions, cursorEnabled: true });

  const stored = db.prepare("SELECT key, value FROM settings").all();
  expect(JSON.stringify(stored)).not.toContain(FAKE_JWT);
  expect(Object.keys(readSettings(db))).toEqual(["ompEnabled", "ompPath", "cursorEnabled"]);
});

it("prices stored OMP events from the bundled rates and leaves unknowns as null", async () => {
  const host = reader();
  await host.fetch();
  const snapshot = await host.getSnapshot({ kind: "all_time" });

  // The fixture line is claude-opus-5: 2 in, 105 out, 37378 cache read, 463
  // cache write at the seeded 5 / 25 / 0.5 / 6.25 per Mtok.
  expect(snapshot.omp.estimatedCents).toBeCloseTo(2.421775, 6);
  // Cursor's cycle still holds unpriced models, so both it and the combined
  // total stay unknown rather than dropping those rows' cost.
  expect(snapshot.cursor.estimatedCents).toBeNull();
  expect(snapshot.estimatedCents).toBeNull();
});

it("prices a cycle aggregate on the next snapshot after Settings adds a rate", async () => {
  const host = reader();
  await host.fetch();

  const before = await host.getSnapshot({ kind: "all_time" });
  const auto = (snapshot: DashboardSnapshot) =>
    snapshot.models.find((row) => row.source === "cursor" && row.model === "default");
  // Cursor's Auto row: real tokens, no public rate.
  expect(auto(before)?.estimatedCents).toBeNull();
  const usageRows = db.prepare("SELECT * FROM usage_events ORDER BY id").all();

  await host.addPrice({
    model: "default",
    provider: "custom",
    inputPerMtok: 1,
    outputPerMtok: 1,
    cacheReadPerMtok: 1,
    cacheWritePerMtok: null,
  });

  const after = await host.getSnapshot({ kind: "all_time" });
  // 3,200,000 + 219,000 + 16,700,000 tokens at $1/Mtok.
  expect(auto(after)?.estimatedCents).toBeCloseTo(2011.9, 5);
  // Tokens are untouched: the cost came from the price table, not a rewrite.
  expect(auto(after)?.tokens).toEqual(auto(before)?.tokens);
  expect(db.prepare("SELECT * FROM usage_events ORDER BY id").all()).toEqual(usageRows);
  // Auto was the last unpriced model in the fixture, so the subtotal resolves:
  // 7565.98 grok-4.6 + 1059.582 opus + 2011.9 auto + 112.34 grok-4.5 + 12.1815 sol.
  expect(after.cursor.estimatedCents).toBeCloseTo(10_761.9835, 4);
});
