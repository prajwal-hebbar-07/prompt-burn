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

    db.close();
  });

  it("reopens an existing file without re-applying schema or re-seeding", () => {
    const path = databasePath(fakeHome());
    const first = openDatabase(path);
    first.exec("INSERT INTO settings (key, value) VALUES ('omp_path', '~/.omp')");
    first.exec("DELETE FROM price_entries WHERE model = 'gemma4'");
    first.close();

    const second = openDatabase(path);
    expect(second.prepare("SELECT COUNT(*) AS n FROM price_entries").get()?.["n"]).toBe(
      BUNDLED_PRICES.length - 1,
    );
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
});
