/**
 * Parallel collection and partial success, entirely offline: a synthetic
 * `state.vscdb` with an unsigned fake JWT, a stubbed `fetch` serving the spike
 * fixtures, and throwaway OMP transcripts under a temp home.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { databasePath, openDatabase } from "@prompt-burn/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectAllSources } from "./index.js";

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

let root: string;
let sessions: string;
let statePath: string;
let dbPath: string;
let db: DatabaseSync;

/** Serves both Cursor fixtures; `status` drives the failure cases. */
function stubFetch(status = 200): typeof fetch {
  return (async (url: string | URL | Request) =>
    new Response(String(url).endsWith("/api/usage-summary") ? SUMMARY : AGGREGATES, {
      status,
    })) as unknown as typeof fetch;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prompt-burn-collect-"));
  sessions = join(root, "omp-sessions");
  mkdirSync(join(sessions, "proj"), { recursive: true });
  writeFileSync(
    join(sessions, "proj", "20260902_074150_abc.jsonl"),
    `${[HEADER, FIXTURE_LINE, FIXTURE_LINE.replace('"566d37c8"', '"bbbb0002"')].join("\n")}\n`,
  );

  statePath = join(root, "state.vscdb");
  const state = new DatabaseSync(statePath);
  state.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
  state.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
    "cursorAuth/accessToken",
    FAKE_JWT,
  );
  state.close();

  dbPath = databasePath(root);
  db = openDatabase(dbPath);
});

afterEach(() => {
  try {
    db.close();
  } catch {
    // A test may have closed it deliberately.
  }
  rmSync(root, { recursive: true, force: true });
});

describe("collectAllSources", () => {
  it("collects both sources and leaves the token out of our database", async () => {
    const result = await collectAllSources({
      db,
      ompDirectory: sessions,
      cursorStatePath: statePath,
      fetchImpl: stubFetch(),
    });

    expect(result.omp).toEqual({
      ok: true,
      sync: { scannedFiles: 1, skippedFiles: 0, insertedEvents: 2 },
    });
    expect(result.cursor.ok).toBe(true);
    expect(result.cursor.cycle).toMatchObject({
      mode: "cycle_aggregate",
      cycleStart: "2026-08-26T07:25:29.000Z",
      cycleEnd: "2026-09-26T07:25:29.000Z",
    });
    expect(result.cursor.cycle?.mode === "cycle_aggregate" && result.cursor.cycle.models).toHaveLength(6);

    db.close();
    expect(readFileSync(dbPath, "latin1")).not.toContain(FAKE_JWT);
  });

  it("syncs OMP while Cursor has no local session", async () => {
    const result = await collectAllSources({
      db,
      ompDirectory: sessions,
      cursorStatePath: join(root, "absent", "state.vscdb"),
      fetchImpl: stubFetch(),
    });

    expect(result.omp.ok).toBe(true);
    expect(result.omp.sync.insertedEvents).toBe(2);
    expect(result.cursor).toMatchObject({ ok: false, reason: "not_installed" });
    expect(result.cursor.cycle).toBeUndefined();
  });

  it("keeps the OMP sync when the Cursor fetch fails", async () => {
    const result = await collectAllSources({
      db,
      ompDirectory: sessions,
      cursorStatePath: statePath,
      fetchImpl: stubFetch(500),
    });

    expect(result.omp.sync.insertedEvents).toBe(2);
    expect(result.cursor).toMatchObject({ ok: false, reason: "fetch_failed" });
    expect(result.cursor.error).toContain("500");
    expect(result.cursor.cycle).toBeUndefined();
  });

  it("keeps the Cursor cycle when the OMP sync fails", async () => {
    // A closed handle is the cheapest real sync failure: `prepare` throws
    // before any row is written.
    db.close();

    const result = await collectAllSources({
      db,
      ompDirectory: sessions,
      cursorStatePath: statePath,
      fetchImpl: stubFetch(),
    });

    expect(result.omp.ok).toBe(false);
    expect(result.omp.sync).toEqual({ scannedFiles: 0, skippedFiles: 0, insertedEvents: 0 });
    expect(result.cursor.ok).toBe(true);
    expect(result.cursor.cycle).toBeDefined();
  });

  it("reports an expired local session without fetching", async () => {
    const expired = join(root, "expired.vscdb");
    const state = new DatabaseSync(expired);
    state.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
    const stale = [
      FAKE_JWT.split(".")[0],
      Buffer.from(JSON.stringify({ sub: "user_01SYNTHETIC", exp: 1_600_000_000 })).toString(
        "base64url",
      ),
      "not-a-signature",
    ].join(".");
    state.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)").run(
      "cursorAuth/accessToken",
      stale,
    );
    state.close();

    let called = 0;
    const result = await collectAllSources({
      db,
      ompDirectory: sessions,
      cursorStatePath: expired,
      fetchImpl: (async () => {
        called += 1;
        return new Response("{}");
      }) as unknown as typeof fetch,
    });

    expect(called).toBe(0);
    expect(result.cursor).toMatchObject({ ok: false, reason: "expired" });
    expect(result.omp.ok).toBe(true);
  });
});
