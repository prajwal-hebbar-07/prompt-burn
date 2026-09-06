import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appDirectory, BUNDLED_PRICES, databasePath, openDatabase } from "./index.js";

const temporaryHomes: string[] = [];

/** A throwaway home directory — tests never touch the real `~/.prompt-burn`. */
function fakeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "prompt-burn-test-"));
  temporaryHomes.push(home);
  return home;
}

afterEach(() => {
  for (const home of temporaryHomes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("databasePath", () => {
  it("resolves under the home directory, outside any install dir", () => {
    expect(databasePath("/Users/someone")).toBe("/Users/someone/.prompt-burn/db.sqlite");
    expect(appDirectory("/Users/someone")).toBe("/Users/someone/.prompt-burn");
    // Same file for desktop and VS Code: the default has no app in its path.
    expect(databasePath()).toMatch(/\/\.prompt-burn\/db\.sqlite$/);
    expect(databasePath()).not.toContain("prompt-burn/packages");
  });
});

describe("openDatabase", () => {
  it("creates the directory, the schema and the bundled prices on first open", () => {
    const path = databasePath(fakeHome());
    const db = openDatabase(path);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row["name"]);
    expect(tables).toContain("usage_events");
    expect(tables).toContain("price_entries");
    expect(tables).toContain("omp_sync_state");
    expect(tables).toContain("settings");
    // Alias map lives in core code; last_success_at is a settings row.
    expect(tables).not.toContain("model_aliases");
    expect(tables).not.toContain("fetch_metadata");

    const prices = db.prepare("SELECT COUNT(*) AS n FROM price_entries").get();
    expect(prices?.["n"]).toBe(BUNDLED_PRICES.length);

    const opus = db.prepare("SELECT * FROM price_entries WHERE model = ?").get("claude-opus-5");
    expect(opus).toMatchObject({
      provider: "anthropic",
      input_per_mtok: 5,
      output_per_mtok: 25,
      cache_read_per_mtok: 0.5,
      cache_write_per_mtok: 6.25,
      effective_until: null,
    });
    // Ollama Cloud is priced from vendor rates, not treated as free.
    const glm = db.prepare("SELECT * FROM price_entries WHERE model = ?").get("glm-5.3-flash");
    expect(glm).toMatchObject({
      provider: "ollama-cloud",
      input_per_mtok: 0.15,
      output_per_mtok: 0.5,
      cache_read_per_mtok: 0.03,
      cache_write_per_mtok: 0,
    });
    // Standard rate, not deepseek's doubled peak-window rate.
    const deepseek = db.prepare("SELECT * FROM price_entries WHERE model = ?").get("deepseek-v4-flash");
    expect(deepseek).toMatchObject({ input_per_mtok: 0.22, output_per_mtok: 0.66 });
    // Ollama publishes no cached-input rate for qwen3.5: unknown, not zero.
    const qwen = db.prepare("SELECT * FROM price_entries WHERE model = ?").get("qwen3.5:397b");
    expect(qwen?.["cache_read_per_mtok"]).toBeNull();
    // Gemini arrives through Antigravity inside OMP; the provider slot is OMP's.
    const gemini = db.prepare("SELECT * FROM price_entries WHERE model = ?").get("gemini-3.8-flash");
    expect(gemini).toMatchObject({
      provider: "google-antigravity",
      input_per_mtok: 0.75,
      output_per_mtok: 3.75,
      cache_read_per_mtok: 0.075,
      cache_write_per_mtok: 0,
    });
    // The Ollama-served open model is not the Google API model.
    const gemma = db.prepare("SELECT * FROM price_entries WHERE model = ?").get("gemma4");
    expect(gemma?.["provider"]).toBe("ollama-cloud");

    db.close();
  });

  it("reopens an existing file, keeps its data, and tops up missing prices", () => {
    const path = databasePath(fakeHome());
    const first = openDatabase(path);
    first.exec("INSERT INTO settings (key, value) VALUES ('omp_path', '~/.omp')");
    // Stands in for a release that adds a model to BUNDLED_PRICES.
    first.exec("DELETE FROM price_entries WHERE model = 'gemma4'");
    // A hand-added rate must survive the top-up, not be duplicated by it.
    first.exec(
      `INSERT INTO price_entries
         (model, provider, effective_from, input_per_mtok, output_per_mtok)
       VALUES ('claude-opus-5', 'custom', '2026-01-01T00:00:00Z', 9, 9)`,
    );
    first.close();

    const second = openDatabase(path);
    // The missing seed is back and nothing else was inserted twice.
    expect(second.prepare("SELECT COUNT(*) AS n FROM price_entries").get()?.["n"]).toBe(
      BUNDLED_PRICES.length + 1,
    );
    expect(
      second.prepare("SELECT COUNT(*) AS n FROM price_entries WHERE model = ?").get("claude-opus-5")
        ?.["n"],
    ).toBe(2);
    expect(second.prepare("SELECT value FROM settings WHERE key = 'omp_path'").get()?.["value"]).toBe(
      "~/.omp",
    );
    second.close();
  });

  it("stores cycle rows without a timestamp and rejects a faked one", () => {
    const db = openDatabase(databasePath(fakeHome()));
    const insert = db.prepare(
      `INSERT INTO usage_events (id, source, period, timestamp, model, raw_model, input, output)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    // Cursor Pro aggregate: real tokens, no timestamp.
    // prettier-ignore
    insert.run("cursor:cycle:claude-opus-5", "cursor", "cycle", "",
      "claude-opus-5", "claude-opus-5-thinking-high", 164, 82300);
    // prettier-ignore
    insert.run("omp:s1:1", "omp", "event", "2026-09-02T08:31:31.505Z",
      "claude-opus-5", "claude-opus-5", 2, 105);

    // A cycle aggregate has no moment in time; the schema refuses to invent one.
    expect(() =>
      insert.run("bad", "cursor", "cycle", "2026-09-02T00:00:00Z", "x", "x", 1, 1),
    ).toThrow();
    // And a timestamped event may not pretend to be one.
    expect(() => insert.run("bad2", "omp", "event", "", "x", "x", 1, 1)).toThrow();

    expect(db.prepare("SELECT COUNT(*) AS n FROM usage_events").get()?.["n"]).toBe(2);
    db.close();
  });

  it("adds the project column, keeps every row, and forces one OMP re-scan", () => {
    const path = databasePath(fakeHome());
    const first = openDatabase(path);
    // Rewind to the shape v1.0.3 shipped: no project column anywhere.
    first.exec(`
      DROP TABLE usage_events;
      CREATE TABLE usage_events (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, period TEXT NOT NULL,
        timestamp TEXT NOT NULL, model TEXT NOT NULL, raw_model TEXT NOT NULL,
        input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0,
        cache_read INTEGER NOT NULL DEFAULT 0, cache_write INTEGER NOT NULL DEFAULT 0,
        session_id TEXT);
      INSERT INTO usage_events VALUES
        ('omp:s1:1', 'omp', 'event', '2026-09-02T08:31:31.505Z', 'claude-opus-5', 'claude-opus-5', 2, 105, 0, 0, 's1'),
        ('cursor:cycle:x', 'cursor', 'cycle', '', 'default', 'default', 1, 1, 0, 0, NULL);
      INSERT INTO omp_sync_state (path, mtime, offset) VALUES ('/w/api/a.jsonl', 1, 400);`);
    first.close();

    const second = openDatabase(path);
    const columns = second
      .prepare("SELECT name FROM pragma_table_info('usage_events')")
      .all()
      .map((row) => row["name"]);
    expect(columns).toContain("project");
    // Rows survive with a NULL project; only the sync state goes, so the next
    // fetch re-reads the transcripts and backfills the `cwd` it finds there.
    const rows = second.prepare("SELECT id, project FROM usage_events ORDER BY id").all();
    expect(rows).toEqual([
      { id: "cursor:cycle:x", project: null },
      { id: "omp:s1:1", project: null },
    ]);
    expect(second.prepare("SELECT COUNT(*) AS n FROM omp_sync_state").get()?.["n"]).toBe(0);
    second.close();

    // Idempotent: a third open neither re-adds the column nor re-clears state.
    const third = openDatabase(path);
    third.exec(
      `INSERT INTO usage_events (id, source, period, timestamp, model, raw_model, project)
       VALUES ('omp:s2:1', 'omp', 'event', '2026-09-05T00:00:00Z', 'm', 'm', '/w/api')`,
    );
    third.close();
    const fourth = openDatabase(path);
    expect(
      fourth.prepare("SELECT project FROM usage_events WHERE id = 'omp:s2:1'").get()?.["project"],
    ).toBe("/w/api");
    fourth.close();
  });
});
