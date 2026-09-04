/**
 * Golden `DashboardSnapshot`s: the spike fixtures in, the whole view model out.
 *
 * The other suites check fields one at a time; this one locks the entire object
 * the UI renders, through the real pipeline — OMP parse, Cursor cycle mapping,
 * `canonicalModelId`, the bundled `price_entries`, `buildDashboardSnapshot`. A
 * mapping, alias, merge, mixed-period or null-poison regression changes one of
 * these literals and fails here.
 *
 * Offline and hermetic: temp OMP directory, temp `~/.prompt-burn`, a synthetic
 * `state.vscdb`, and an injected `fetch` that answers from the committed
 * redacted fixtures. Nothing reads a real home directory or cursor.com.
 *
 * Expected costs come from the vendors' published rates in
 * `packages/db/src/prices.ts`, computed by hand — never from OMP's own
 * `usage.cost` and never from Cursor's `totalCents`:
 *
 *   claude-opus-5 (OMP)     2·$5 + 105·$25 + 37378·$0.50 + 463·$6.25 = 2.421775¢
 *   gemini-3.8-flash (OMP)  4159·$0.75 + 155·$3.75 + 187535·$0.075   = 1.7765625¢
 *   claude-opus-5 (Cursor)  164·$5 + 82300·$25 + 7.35M·$0.50 + 778k·$6.25 = 1059.582¢
 *
 * Gemini's `reasoningTokens: 110` is not a fifth billed kind — output already
 * includes thinking — so it never appears in a token total here.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { databasePath, openDatabase } from "@prompt-burn/db";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createUsageReader, type DashboardSnapshot, type PeriodFilter } from "./index.js";

const fixture = (name: string) =>
  readFileSync(new URL(`../../../docs/fixtures/${name}`, import.meta.url), "utf8");

/** One transcript line per file line: the parser reads JSONL, not JSON. */
const OMP_LINES = [fixture("omp-session-line.json"), fixture("omp-gemini-session-line.json")].map(
  (json) => json.replace(/\s+/g, " "),
);
const SUMMARY = fixture("cursor-usage-summary.json");
const AGGREGATES = fixture("cursor-cycle-aggregates.json");

const SESSION_HEADER = JSON.stringify({
  type: "session",
  version: 3,
  id: "01a06111-2b47-75b9-9bd1-acfc5358378f",
  timestamp: "2026-09-02T07:41:50.279Z",
  cwd: "/Users/example/project",
});

/** Unsigned, synthetic: the auth read only looks at `sub` and `exp`. */
const FAKE_JWT = [
  Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
  Buffer.from(
    JSON.stringify({ sub: "user_01SYNTHETIC", exp: Math.floor(Date.now() / 1000) + 86_400 }),
  ).toString("base64url"),
  "not-a-signature",
].join(".");

/**
 * 18:30 IST on 4 Sep 2026, so "today" is 2026-09-04 in the device timezone:
 * the Gemini line (12:59Z) is inside it and the Anthropic line (2 Sep) is not.
 */
const NOW = new Date("2026-09-04T13:00:00.000Z");

/** Both OMP rows, in stored order — `loadUsageEvents` sorts by timestamp. */
const OMP_OPUS: DashboardSnapshot["models"][number] = {
  source: "omp",
  model: "claude-opus-5",
  tokens: { input: 2, output: 105, cacheRead: 37378, cacheWrite: 463 },
  estimatedCents: 2.421775,
};
const OMP_GEMINI: DashboardSnapshot["models"][number] = {
  source: "omp",
  model: "gemini-3.8-flash",
  tokens: { input: 4159, output: 155, cacheRead: 187535, cacheWrite: 0 },
  estimatedCents: 1.7765625,
};

/**
 * Five rows from six `aggregations`: `cursor-grok-4.6-high-fast` canonicalizes
 * onto `cursor-grok-4.6-high` and merges into it. `-medium` is not stripped,
 * the `cursor-` prefix survives, and `default` (Auto) stays as an unpriced row
 * rather than vanishing. `claude-opus-5` here is a second row for a model OMP
 * also reports: `(source, model)` is the key, and nothing dedupes.
 */
const CURSOR_ROWS: DashboardSnapshot["models"] = [
  {
    source: "cursor",
    model: "cursor-grok-4.6-high",
    tokens: { input: 9_544_000, output: 1_167_800, cacheRead: 99_130_000, cacheWrite: 0 },
    estimatedCents: null,
  },
  {
    source: "cursor",
    model: "claude-opus-5",
    tokens: { input: 164, output: 82_300, cacheRead: 7_350_000, cacheWrite: 778_000 },
    estimatedCents: 1059.582,
  },
  {
    source: "cursor",
    model: "default",
    tokens: { input: 3_200_000, output: 219_000, cacheRead: 16_700_000, cacheWrite: 0 },
    estimatedCents: null,
  },
  {
    source: "cursor",
    model: "cursor-grok-4.5-high",
    tokens: { input: 262_000, output: 24_400, cacheRead: 1_510_000, cacheWrite: 0 },
    estimatedCents: null,
  },
  {
    source: "cursor",
    model: "gpt-5.6-sol-medium",
    tokens: { input: 3, output: 4060, cacheRead: 0, cacheWrite: 74_400 },
    estimatedCents: null,
  },
];

/**
 * Cycle-to-date, whatever the period is: never filtered, never split into days.
 * The window is the usage-summary's billing cycle, not month-aligned. The
 * subtotal is `null` because unpriced models are included — one unknown rate
 * poisons every total containing it.
 */
const CURSOR_SLICE: DashboardSnapshot["cursor"] = {
  estimatedCents: null,
  tokens: { input: 13_006_167, output: 1_497_560, cacheRead: 124_690_000, cacheWrite: 852_400 },
  mode: "cycle_aggregate",
  cycleLabel: "Cycle to date",
  cycleStart: "2026-08-26T07:25:29.000Z",
  cycleEnd: "2026-09-26T07:25:29.000Z",
};

const ALL_TIME: DashboardSnapshot = {
  period: { kind: "all_time" },
  // Cursor holds unpriced models, so the combined estimate is unknown — the UI
  // renders `—`, never `$0`, and never Cursor's own cents.
  estimatedCents: null,
  omp: {
    estimatedCents: 4.1983375,
    tokens: { input: 4161, output: 260, cacheRead: 224_913, cacheWrite: 463 },
  },
  cursor: CURSOR_SLICE,
  models: [OMP_OPUS, OMP_GEMINI, ...CURSOR_ROWS],
  // All-time is the one period a cycle-to-date Cursor total does not clash with.
  mixedPeriod: false,
  fetch: { lastSuccessAt: null, status: "idle" },
};

const TODAY: DashboardSnapshot = {
  period: { kind: "today" },
  estimatedCents: null,
  // OMP filters to the Gemini turn; Cursor does not move.
  omp: {
    estimatedCents: 1.7765625,
    tokens: { input: 4159, output: 155, cacheRead: 187_535, cacheWrite: 0 },
  },
  cursor: CURSOR_SLICE,
  models: [OMP_GEMINI, ...CURSOR_ROWS],
  mixedPeriod: true,
  fetch: { lastSuccessAt: null, status: "idle" },
};

let root: string;
let db: DatabaseSync;
let sessions: string;
let statePath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prompt-burn-golden-"));

  sessions = join(root, "omp-sessions");
  mkdirSync(join(sessions, "project"), { recursive: true });
  writeFileSync(
    join(sessions, "project", "20260902_074150_golden.jsonl"),
    `${[SESSION_HEADER, ...OMP_LINES].join("\n")}\n`,
  );

  statePath = join(root, "state.vscdb");
  const state = new DatabaseSync(statePath);
  state.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
  state
    .prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)")
    .run("cursorAuth/accessToken", FAKE_JWT);
  state.close();

  // New file, so `openDatabase` applies the schema and seeds the bundled rates.
  db = openDatabase(databasePath(root));
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

/** Costs are floats; a golden compares them to the nano-cent, not to the bit. */
function rounded(snapshot: DashboardSnapshot): DashboardSnapshot {
  const cents = (value: number | null) =>
    value === null ? null : Math.round(value * 1e9) / 1e9;
  return {
    ...snapshot,
    estimatedCents: cents(snapshot.estimatedCents),
    omp: { ...snapshot.omp, estimatedCents: cents(snapshot.omp.estimatedCents) },
    cursor: { ...snapshot.cursor, estimatedCents: cents(snapshot.cursor.estimatedCents) },
    models: snapshot.models.map((row) => ({ ...row, estimatedCents: cents(row.estimatedCents) })),
  };
}

async function snapshots(): Promise<Record<"allTime" | "today", DashboardSnapshot>> {
  const reader = createUsageReader(db, {
    ompDirectory: sessions,
    cursorStatePath: statePath,
    // Cycle aggregates carry no timestamp and price at "now"; the bundled rates
    // are open-ended from 1970, so this is the rate in force.
    now: () => NOW,
    fetchImpl: (async (url: string | URL | Request) =>
      new Response(String(url).endsWith("/api/usage-summary") ? SUMMARY : AGGREGATES)) as unknown as typeof fetch,
  });

  const pass = await reader.fetch();
  expect(pass).toMatchObject({ ok: true, omp: { insertedEvents: 2 }, cursor: { models: 6 } });

  const period = (kind: PeriodFilter["kind"]) => ({ kind }) as PeriodFilter;
  return {
    allTime: await reader.getSnapshot(period("all_time")),
    today: await reader.getSnapshot(period("today")),
  };
}

it("locks the all-time snapshot for both OMP lines plus the Cursor cycle", async () => {
  const { allTime } = await snapshots();

  expect(rounded(allTime)).toEqual(ALL_TIME);
});

it("filters OMP by the calendar day while the Cursor cycle stays whole", async () => {
  const { allTime, today } = await snapshots();

  expect(rounded(today)).toEqual(TODAY);
  // The same cycle totals, byte for byte, under a different period: cycle
  // aggregates are never shrunk to the window, and never split into days.
  expect(today.cursor).toEqual(allTime.cursor);
});
