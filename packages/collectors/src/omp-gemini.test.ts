/**
 * One real Gemini-through-Antigravity turn, priced end to end: the redacted
 * fixture (`docs/fixtures/omp-gemini-session-line.json`) through the OMP parser,
 * through the bundled `price_entries` row, to a locked cent figure.
 *
 * This is the regression lock for the seeded Google rate. It fails if the parser
 * stops reading a Gemini line, if the bundled rate moves, or if a token kind
 * starts or stops being billed — including `reasoningTokens`, which `output`
 * already pays for and which must never be added on top.
 *
 * The fixture's own `usage.cost` is never asserted against: the estimate is ours,
 * recomputed from our price DB so a rate change reprices old events. It happens
 * to agree here (see the comment below), which is the only use OMP's number has.
 * Nothing reads a real `~/.omp` or a real `~/.prompt-burn`.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { databasePath, estimateCents, openDatabase, resolvePrice } from "@prompt-burn/db";
import { afterEach, beforeEach, expect, it } from "vitest";
import { parseOmpSessionFile } from "./index.js";

const FIXTURE_LINE = readFileSync(
  new URL("../../../docs/fixtures/omp-gemini-session-line.json", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");

const SESSION_ID = "01a2b3c4-5d6e-77f8-9a0b-1c2d3e4f5a6b";

const HEADER = JSON.stringify({
  type: "session",
  version: 3,
  id: SESSION_ID,
  timestamp: "2026-09-04T12:41:50.279Z",
  cwd: "/Users/example/project",
});

/**
 * The fixture's tokens at the bundled Gemini rate: $0.75 input, $3.75 output
 * (thinking included), $0.075 cache read, cache write not a category.
 *
 *   4159 × 0.75 + 155 × 3.75 + 187535 × 0.075 = 17765.625 USD per Mtok-unit
 *   ÷ 1e6 × 100 = 1.7765625 cents
 *
 * Billing the line's 110 `reasoningTokens` at the output rate would add 0.04125c;
 * dropping cache read would collapse this to 0.37005c. Either regression fails here.
 */
const LOCKED_CENTS = 1.7765625;

let root: string;
let home: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prompt-burn-gemini-"));
  home = join(root, "home");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

it("prices a Gemini OMP turn from the bundled rate, not from OMP's own cost", () => {
  const path = join(root, "proj", "20260904_124150_abc.jsonl");
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${HEADER}\n${FIXTURE_LINE}\n`);

  const [event, ...rest] = parseOmpSessionFile(path);
  expect(rest).toEqual([]);
  expect(event).toEqual({
    id: `omp:${SESSION_ID}:c646d42b`,
    // Antigravity is a provider inside OMP, never a source of its own.
    source: "omp",
    timestamp: "2026-09-04T12:59:03.516Z",
    model: "gemini-3.8-flash",
    rawModel: "gemini-3.8-flash",
    tokens: { input: 4159, output: 155, cacheRead: 187535, cacheWrite: 0 },
    sessionId: SESSION_ID,
  });

  const db = openDatabase(databasePath(home));
  try {
    const rate = resolvePrice(db, event!.model, event!.timestamp);
    expect(rate).toMatchObject({ provider: "google-antigravity", inputPerMtok: 0.75 });
    expect(estimateCents(rate, event!.tokens)).toBeCloseTo(LOCKED_CENTS, 9);
    // Cross-check only: OMP's own dollar figure for this line agrees to the cent
    // fraction ($0.017765625). It is never stored and never asserted as the source
    // of truth — the DB is.
    expect(LOCKED_CENTS / 100).toBeCloseTo(0.017765625, 9);
  } finally {
    db.close();
  }
});
