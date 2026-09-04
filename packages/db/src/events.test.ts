import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { databasePath, loadUsageEvents, openDatabase } from "./index.js";

const temporaryHomes: string[] = [];
let db: DatabaseSync | undefined;

function openTemp(): DatabaseSync {
  const home = mkdtempSync(join(tmpdir(), "prompt-burn-events-"));
  temporaryHomes.push(home);
  db = openDatabase(databasePath(home));
  return db;
}

afterEach(() => {
  db?.close();
  db = undefined;
  for (const home of temporaryHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("loadUsageEvents", () => {
  it("returns nothing on a fresh database, for either source", () => {
    const db = openTemp();
    expect(loadUsageEvents(db)).toEqual([]);
    expect(loadUsageEvents(db, "omp")).toEqual([]);
    expect(loadUsageEvents(db, "cursor")).toEqual([]);
  });

  it("maps stored columns onto the domain shape and filters by source", () => {
    const db = openTemp();
    const insert = db.prepare(
      `INSERT INTO usage_events
         (id, source, period, timestamp, model, raw_model, input, output, cache_read, cache_write, session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run("omp:s1:line1", "omp", "event", "2026-09-02T08:31:31.505Z", "claude-opus-5", "claude-opus-5", 2, 105, 37378, 463, "s1");
    insert.run("cursor:c1", "cursor", "cycle", "", "glm-5.3-flash", "glm-5.3-flash", 10, 20, 0, 0, null);

    expect(loadUsageEvents(db, "omp")).toEqual([
      {
        id: "omp:s1:line1",
        source: "omp",
        timestamp: "2026-09-02T08:31:31.505Z",
        model: "claude-opus-5",
        rawModel: "claude-opus-5",
        tokens: { input: 2, output: 105, cacheRead: 37378, cacheWrite: 463 },
        sessionId: "s1",
      },
    ]);

    // A cycle row's empty timestamp survives — nothing fakes a time.
    const cursor = loadUsageEvents(db, "cursor");
    expect(cursor).toHaveLength(1);
    expect(cursor[0]?.timestamp).toBe("");
    expect("sessionId" in (cursor[0] ?? {})).toBe(false);

    // No filter: both sources, oldest timestamp first (empty sorts first).
    expect(loadUsageEvents(db).map((event) => event.id)).toEqual(["cursor:c1", "omp:s1:line1"]);
  });
});