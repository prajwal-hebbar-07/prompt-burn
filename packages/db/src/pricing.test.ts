import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SEED_EFFECTIVE_FROM,
  databasePath,
  estimateCents,
  insertPriceEntry,
  openDatabase,
  resolvePrice,
} from "./index.js";

let home: string;
let db: DatabaseSync;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "prompt-burn-test-"));
  db = openDatabase(databasePath(home));
});

afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

function addPrice(
  model: string,
  effectiveFrom: string,
  effectiveUntil: string | null,
  inputPerMtok: number,
  outputPerMtok: number,
): void {
  db.prepare(
    `INSERT INTO price_entries
       (model, provider, effective_from, effective_until, input_per_mtok, output_per_mtok,
        cache_read_per_mtok, cache_write_per_mtok)
     VALUES (?, 'test', ?, ?, ?, ?, NULL, NULL)`,
  ).run(model, effectiveFrom, effectiveUntil, inputPerMtok, outputPerMtok);
}

describe("resolvePrice", () => {
  it("picks the window that covers the timestamp", () => {
    addPrice("test-model", "2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z", 10, 50);
    addPrice("test-model", "2026-06-01T00:00:00Z", "2026-09-01T00:00:00Z", 20, 100);

    expect(resolvePrice(db, "test-model", "2026-03-15T12:00:00Z")?.inputPerMtok).toBe(10);
    expect(resolvePrice(db, "test-model", "2026-07-15T12:00:00Z")?.inputPerMtok).toBe(20);
    // Past the last window's end: no rate, not the most recent one.
    expect(resolvePrice(db, "test-model", "2026-10-01T00:00:00Z")).toBeNull();
    // Before the first window opens.
    expect(resolvePrice(db, "test-model", "2025-12-31T23:59:59Z")).toBeNull();
  });

  it("treats effective_until as exclusive and effective_from as inclusive", () => {
    addPrice("edge-model", "2026-01-01T00:00:00Z", "2026-06-01T00:00:00Z", 10, 50);
    addPrice("edge-model", "2026-06-01T00:00:00Z", null, 20, 100);

    // Exactly at the boundary the *next* row applies, never the closing one.
    expect(resolvePrice(db, "edge-model", "2026-06-01T00:00:00Z")?.inputPerMtok).toBe(20);
    expect(resolvePrice(db, "edge-model", "2026-05-31T23:59:59.999Z")?.inputPerMtok).toBe(10);
    // effective_from itself is inside the window.
    expect(resolvePrice(db, "edge-model", "2026-01-01T00:00:00Z")?.inputPerMtok).toBe(10);
  });

  it("matches an open-ended row and the bundled seeds", () => {
    const opus = resolvePrice(db, "claude-opus-5", "2026-09-02T08:31:31.505Z");
    expect(opus).toMatchObject({
      provider: "anthropic",
      effectiveUntil: null,
      inputPerMtok: 5,
      outputPerMtok: 25,
      cacheReadPerMtok: 0.5,
      cacheWritePerMtok: 6.25,
    });
    // Ollama Cloud is priced, never free.
    expect(resolvePrice(db, "glm-5.3-flash", "2026-09-02T08:31:31.505Z")?.inputPerMtok).toBe(0.15);
  });

  it("prices the Cursor-side models at their vendors' public rates", () => {
    const at = "2026-09-02T08:31:31.505Z";
    expect(resolvePrice(db, "cursor-grok-4.6-high", at)).toMatchObject({
      provider: "xai",
      inputPerMtok: 2,
      outputPerMtok: 6,
      cacheReadPerMtok: 0.5,
    });
    // 4.5 and 4.6 differ only in the cached-input rate.
    expect(resolvePrice(db, "cursor-grok-4.5-high", at)?.cacheReadPerMtok).toBe(0.3);
    // Effort level is not a price tier: xhigh costs what high costs.
    expect(resolvePrice(db, "cursor-grok-4.6-xhigh", at)?.inputPerMtok).toBe(2);
    expect(resolvePrice(db, "gpt-5.6-sol-medium", at)).toMatchObject({
      provider: "openai",
      inputPerMtok: 5,
      outputPerMtok: 30,
    });
    expect(resolvePrice(db, "composer-2.5", at)).toMatchObject({
      provider: "cursor",
      inputPerMtok: 0.5,
      outputPerMtok: 2.5,
    });
    // Cursor's id for Haiku 4.5, on Anthropic's published rate.
    expect(resolvePrice(db, "claude-4.5-haiku-thinking", at)).toMatchObject({
      provider: "anthropic",
      inputPerMtok: 1,
      outputPerMtok: 5,
    });
  });

  it("returns null for models nobody has priced", () => {
    // Cursor Auto routes to whichever model Cursor picks per request, so there
    // is no rate to bundle; a Settings insert is the only way it gets one.
    expect(resolvePrice(db, "default", "2026-09-02T08:31:31.505Z")).toBeNull();
    // The `-fast` Composer variant bills differently and is not bundled until
    // it is actually observed on an account.
    expect(resolvePrice(db, "composer-2.5-fast", "2026-09-02T08:31:31.505Z")).toBeNull();
  });

  it("refuses to price a cycle aggregate's empty timestamp", () => {
    expect(resolvePrice(db, "claude-opus-5", "")).toBeNull();
  });

  it("prefers the latest effective_from when windows overlap", () => {
    addPrice("overlap", "2026-01-01T00:00:00Z", null, 10, 50);
    addPrice("overlap", "2026-05-01T00:00:00Z", null, 30, 150);

    expect(resolvePrice(db, "overlap", "2026-07-01T00:00:00Z")?.inputPerMtok).toBe(30);
  });
});

describe("retroactive pricing", () => {
  const timestamp = "2026-09-02T08:31:31.505Z";

  function insertEvent(model: string): void {
    db.prepare(
      `INSERT INTO usage_events
         (id, source, period, timestamp, model, raw_model, input, output, cache_read, cache_write)
       VALUES ('omp:s1:1', 'omp', 'event', ?, ?, ?, 1000, 2000, 0, 0)`,
    ).run(timestamp, model, model);
  }

  it("prices an existing event once a rate is inserted, without touching the row", () => {
    insertEvent("brand-new-model");
    const before = db.prepare("SELECT * FROM usage_events WHERE id = 'omp:s1:1'").get();
    expect(resolvePrice(db, "brand-new-model", timestamp)).toBeNull();

    // Settings inserts a price; `insertPriceEntry` is that path.
    addPrice("brand-new-model", "1970-01-01T00:00:00Z", null, 5, 25);

    expect(resolvePrice(db, "brand-new-model", timestamp)?.inputPerMtok).toBe(5);
    // The usage row is untouched: cost is a join, never a stored column.
    expect(db.prepare("SELECT * FROM usage_events WHERE id = 'omp:s1:1'").get()).toEqual(before);
  });

  it("keeps old events on the old rate when a new rate lands", () => {
    insertEvent("claude-sonnet-5");
    // A rate change closes the old row and opens a new one — no UPDATE of rates.
    db.prepare(
      "UPDATE price_entries SET effective_until = ? WHERE model = 'claude-sonnet-5'",
    ).run("2026-10-01T00:00:00Z");
    addPrice("claude-sonnet-5", "2026-10-01T00:00:00Z", null, 3, 15);

    expect(resolvePrice(db, "claude-sonnet-5", timestamp)?.inputPerMtok).toBe(2);
    expect(resolvePrice(db, "claude-sonnet-5", "2026-11-01T00:00:00Z")?.inputPerMtok).toBe(3);
  });

  it("covers stored history and cycle aggregates when Settings adds a rate", () => {
    insertEvent("cursor-grok-4.6-high");

    insertPriceEntry(db, {
      model: "cursor-grok-4.6-high",
      provider: "custom",
      inputPerMtok: 3,
      outputPerMtok: 15,
      cacheReadPerMtok: 0.3,
      cacheWritePerMtok: null,
    });

    const rate = resolvePrice(db, "cursor-grok-4.6-high", timestamp);
    // Backdated and open-ended: the event already on disk prices, and so does
    // a cycle aggregate, which the reader resolves at the current instant.
    expect(rate?.effectiveFrom).toBe(SEED_EFFECTIVE_FROM);
    expect(rate?.effectiveUntil).toBeNull();
    expect(estimateCents(rate, { input: 1_000_000, output: 0 })).toBe(300);
    expect(resolvePrice(db, "cursor-grok-4.6-high", new Date().toISOString())).not.toBeNull();
    // A blank cache-write rate stays unknown, never free.
    expect(estimateCents(rate, { input: 10, output: 0, cacheWrite: 5 })).toBeNull();
  });
});

describe("estimateCents", () => {
  const at = "2026-09-02T08:31:31.505Z";

  it("converts tokens at USD per million into cents", () => {
    const rate = resolvePrice(db, "claude-opus-5", at);
    // 1M input at $5 = 500c; 1M output at $25 = 2500c.
    expect(estimateCents(rate, { input: 1_000_000, output: 1_000_000 })).toBeCloseTo(3000, 9);
    // Cache read $0.50/MTok, cache write $6.25/MTok.
    expect(
      estimateCents(rate, { input: 0, output: 0, cacheRead: 2_000_000, cacheWrite: 100_000 }),
    ).toBeCloseTo(100 + 62.5, 9);
    expect(estimateCents(rate, { input: 0, output: 0 })).toBe(0);
  });

  it("is null when the model has no rate — never zero", () => {
    expect(estimateCents(resolvePrice(db, "default", at), { input: 5, output: 5 })).toBeNull();
  });

  it("is null when a present token kind has no published rate", () => {
    // Ollama publishes no cached-input rate for qwen3.5.
    const rate = resolvePrice(db, "qwen3.5:397b", at);
    expect(rate?.cacheReadPerMtok).toBeNull();
    expect(estimateCents(rate, { input: 1_000_000, output: 0, cacheRead: 10 })).toBeNull();
    // Zero cache tokens do not poison an otherwise known price.
    expect(estimateCents(rate, { input: 1_000_000, output: 0, cacheRead: 0 })).toBeCloseTo(60, 9);
    expect(estimateCents(rate, { input: 1_000_000, output: 0 })).toBeCloseTo(60, 9);
  });
});

describe("gemini through antigravity", () => {
  // A real OMP Gemini line: cacheRead is often non-zero, cacheWrite always 0.
  const at = "2026-09-04T09:12:44.113Z";

  it("prices an OMP Gemini turn from the bundled seed", () => {
    const rate = resolvePrice(db, "gemini-3.8-flash", at);
    expect(rate).toMatchObject({
      provider: "google-antigravity",
      effectiveUntil: null,
      inputPerMtok: 0.75,
      outputPerMtok: 3.75,
      cacheReadPerMtok: 0.075,
    });
    // 1M input at $0.75 = 75c; 1M output at $3.75 = 375c; 1M cached at $0.075.
    expect(
      estimateCents(rate, {
        input: 1_000_000,
        output: 1_000_000,
        cacheRead: 1_000_000,
        cacheWrite: 0,
      }),
    ).toBeCloseTo(75 + 375 + 7.5, 9);
  });

  it("does not confuse gemma4 on Ollama Cloud with Google Gemini", () => {
    expect(resolvePrice(db, "gemma4", at)?.provider).toBe("ollama-cloud");
    // No other Gemini id is seeded: only the one OMP was observed writing.
    expect(resolvePrice(db, "gemini-3.8-pro", at)).toBeNull();
  });
});
