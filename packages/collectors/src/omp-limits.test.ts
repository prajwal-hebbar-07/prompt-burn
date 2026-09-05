/**
 * `readOmpLimits` against a stand-in for OMP's `~/.omp/agent/agent.db`.
 *
 * The table is an append-only series — OMP writes a row per limit per refresh
 * — so the interesting behaviour is which row wins, which rows are too old to
 * mean anything, and that two Claude subscriptions stay two accounts.
 *
 * The schema below is copied from a real OMP install (2026-09-05); this
 * package never creates it.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { ompAgentDatabase, readOmpLimits } from "./omp-limits.js";

const SCHEMA = `
  CREATE TABLE usage_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recorded_at INTEGER NOT NULL,
    provider TEXT NOT NULL,
    account_key TEXT NOT NULL,
    email TEXT,
    account_id TEXT,
    limit_id TEXT NOT NULL,
    label TEXT NOT NULL,
    window_label TEXT,
    used_fraction REAL,
    status TEXT,
    resets_at INTEGER
  )`;

const NOW = new Date("2026-09-05T12:00:00.000Z");
const ACCOUNT_A = "oauth|account:aaa|email:a@example.com|org:one";
const ACCOUNT_B = "oauth|account:bbb|email:b@example.com|org:two";

interface Row {
  at?: Date;
  provider?: string;
  account?: string;
  id: string;
  label: string;
  window?: string | null;
  used?: number | null;
  resets?: Date | null;
}

const roots: string[] = [];

/** A fresh agent database holding exactly `rows`, in insertion order. */
function agentDatabase(rows: Row[]): string {
  const root = mkdtempSync(join(tmpdir(), "prompt-burn-limits-"));
  roots.push(root);
  const file = join(root, "agent.db");
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const insert = db.prepare(
    `INSERT INTO usage_history
       (recorded_at, provider, account_key, email, account_id, limit_id, label,
        window_label, used_fraction, status, resets_at)
     VALUES (?, ?, ?, 'a@example.com', 'aaa', ?, ?, ?, ?, 'ok', ?)`,
  );
  for (const row of rows) {
    insert.run(
      (row.at ?? NOW).getTime(),
      row.provider ?? "anthropic",
      row.account ?? ACCOUNT_A,
      row.id,
      row.label,
      row.window === undefined ? "5 Hour" : row.window,
      row.used === undefined ? 0 : row.used,
      row.resets === undefined ? null : (row.resets?.getTime() ?? null),
    );
  }
  db.close();
  return file;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ompAgentDatabase", () => {
  it("sits beside the sessions directory it belongs to", () => {
    expect(ompAgentDatabase("/home/me/.omp/agent/sessions")).toBe("/home/me/.omp/agent/agent.db");
    // A trailing separator is the same install, not a different one.
    expect(ompAgentDatabase("/home/me/.omp/agent/sessions/")).toBe("/home/me/.omp/agent/agent.db");
  });
});

describe("readOmpLimits", () => {
  it("says nothing when OMP has never run here", () => {
    expect(readOmpLimits(join(tmpdir(), "prompt-burn-absent", "agent.db"), NOW)).toEqual([]);
  });

  it("says nothing when the database predates the table", () => {
    const root = mkdtempSync(join(tmpdir(), "prompt-burn-limits-"));
    roots.push(root);
    const file = join(root, "agent.db");
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE cache (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.close();

    expect(readOmpLimits(file, NOW)).toEqual([]);
  });

  it("takes the newest row of each series and drops the history behind it", () => {
    const file = agentDatabase([
      {
        at: new Date("2026-09-05T09:00:00.000Z"),
        id: "anthropic:5h",
        label: "Claude 5 Hour",
        used: 0.66,
        resets: new Date("2026-09-05T14:00:00.000Z"),
      },
      {
        at: new Date("2026-09-05T11:57:43.838Z"),
        id: "anthropic:5h",
        label: "Claude 5 Hour",
        used: 0.25,
        resets: new Date("2026-09-05T16:39:59.697Z"),
      },
    ]);

    expect(readOmpLimits(file, NOW)).toEqual([
      {
        provider: "anthropic",
        observedAt: "2026-09-05T11:57:43.838Z",
        limits: [
          {
            id: "anthropic:5h",
            label: "Claude 5 Hour",
            windowLabel: "5 Hour",
            usedFraction: 0.25,
            resetsAt: "2026-09-05T16:39:59.697Z",
          },
        ],
      },
    ]);
  });

  it("keeps two subscriptions apart and carries no account identity", () => {
    const file = agentDatabase([
      { id: "anthropic:5h", label: "Claude 5 Hour", used: 0.38 },
      { id: "anthropic:7d", label: "Claude 7 Day", window: "7 Day", used: 0.19 },
      { account: ACCOUNT_B, id: "anthropic:5h", label: "Claude 5 Hour", used: 0.82 },
      { account: ACCOUNT_B, id: "anthropic:7d", label: "Claude 7 Day", window: "7 Day", used: 0.41 },
    ]);

    const groups = readOmpLimits(file, NOW);

    expect(groups.map((group) => group.limits.map((limit) => limit.usedFraction))).toEqual([
      [0.38, 0.19],
      [0.82, 0.41],
    ]);
    // The email and the account id stay in OMP's database.
    expect(JSON.stringify(groups)).not.toContain("example.com");
    expect(JSON.stringify(groups)).not.toContain("aaa");
  });

  it("drops observations older than the longest window they could describe", () => {
    const file = agentDatabase([
      { at: new Date("2026-08-20T12:00:00.000Z"), id: "anthropic:5h", label: "Claude 5 Hour" },
      { provider: "google-antigravity", id: "google-antigravity:google:default:gemini-weekly", label: "Usage (Google)", window: "Weekly", used: 0.064 },
    ]);

    expect(readOmpLimits(file, NOW).map((group) => group.provider)).toEqual(["google-antigravity"]);
  });

  it("keeps a window with no clock, and clamps a provider that overshoots", () => {
    const file = agentDatabase([
      { id: "anthropic:extra", label: "Claude Extra Usage", window: "extra", used: 1.04 },
      { id: "anthropic:7d", label: "Claude 7 Day", window: null, used: null },
    ]);

    expect(readOmpLimits(file, NOW)[0]?.limits).toEqual([
      {
        id: "anthropic:7d",
        label: "Claude 7 Day",
        usedFraction: null,
        resetsAt: null,
      },
      {
        id: "anthropic:extra",
        label: "Claude Extra Usage",
        windowLabel: "extra",
        usedFraction: 1,
        resetsAt: null,
      },
    ]);
  });
});
