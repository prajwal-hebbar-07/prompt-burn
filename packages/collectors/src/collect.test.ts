/**
 * Parallel collection and partial success, entirely offline: a synthetic
 * `state.vscdb` with an unsigned fake JWT, a stubbed `fetch` serving the spike
 * fixtures, and throwaway OMP and Claude Code transcripts under a temp home.
 *
 * Every case injects both transcript directories. A default would walk the
 * developer's own `~/.omp` and `~/.claude`, which is neither hermetic nor
 * theirs to read.
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
let claudeProjects: string;
let statePath: string;
let dbPath: string;
let db: DatabaseSync;

/** One Claude Code assistant turn: Anthropic's field names, its own cwd. */
const CLAUDE_LINE = JSON.stringify({
  type: "assistant",
  uuid: "8b6e7d3a-1111-4c22-9d55-aaaabbbbcccc",
  requestId: "req_011XYZ",
  sessionId: "6f1d0a2c-6d2f-4a0b-9c34-2f3ab1c5d7e0",
  cwd: "/Users/example/claude-project",
  timestamp: "2026-09-02T09:00:00.000Z",
  message: {
    id: "msg_01ABCDEF",
    role: "assistant",
    model: "claude-opus-5",
    usage: { input_tokens: 10, output_tokens: 20 },
  },
});

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

  claudeProjects = join(root, "claude-projects");
  mkdirSync(join(claudeProjects, "-Users-example-claude-project"), { recursive: true });
  writeFileSync(
    join(claudeProjects, "-Users-example-claude-project", "session.jsonl"),
    `${CLAUDE_LINE}\n`,
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
  it("collects every source and leaves the token out of our database", async () => {
    const result = await collectAllSources({
      db,
      ompDirectory: sessions,
      claudeDirectory: claudeProjects,
      cursorStatePath: statePath,
      fetchImpl: stubFetch(),
    });

    expect(result.omp).toEqual({
      ok: true,
      sync: { scannedFiles: 1, skippedFiles: 0, insertedEvents: 2 },
    });
    // Its own walk, its own counters, its own rows: nothing about Claude Code
    // rides on OMP's pass, even though both bill the same subscription.
    expect(result.claudeCode).toEqual({
      ok: true,
      sync: { scannedFiles: 1, skippedFiles: 0, insertedEvents: 1 },
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
      claudeDirectory: claudeProjects,
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
      claudeDirectory: claudeProjects,
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
      claudeDirectory: claudeProjects,
      cursorStatePath: statePath,
      fetchImpl: stubFetch(),
    });

    expect(result.omp.ok).toBe(false);
    expect(result.omp.sync).toEqual({ scannedFiles: 0, skippedFiles: 0, insertedEvents: 0 });
    // Same closed handle, same verdict: one sync failing is not the other's
    // problem, and neither is a failed pass for Cursor.
    expect(result.claudeCode.ok).toBe(false);
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
      claudeDirectory: claudeProjects,
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

  it("reads nothing for a source the toggle switched off", async () => {
    const result = await collectAllSources({
      db,
      ompDirectory: sessions,
      // A directory full of transcripts, deliberately not read.
      claudeDirectory: claudeProjects,
      cursorStatePath: statePath,
      fetchImpl: stubFetch(),
      claudeEnabled: false,
    });

    // Disabled is clean and empty, never an error — and no row lands.
    expect(result.claudeCode).toEqual({
      ok: true,
      sync: { scannedFiles: 0, skippedFiles: 0, insertedEvents: 0 },
    });
    expect(
      db.prepare("SELECT COUNT(*) AS n FROM usage_events WHERE source = 'claude-code'").get()?.[
        "n"
      ],
    ).toBe(0);
    expect(result.omp.sync.insertedEvents).toBe(2);
  });
});
