/**
 * Built on the spike fixture (`docs/fixtures/omp-session-line.json`) — one
 * redacted assistant message — wrapped in synthetic transcripts. Nothing here
 * reads a real `~/.omp`.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectOmpEvents, defaultSessionsDirectory, parseOmpSessionFile } from "./index.js";

const FIXTURE_LINE = readFileSync(
  new URL("../../../docs/fixtures/omp-session-line.json", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");

const SESSION_ID = "01a06111-2b47-75b9-9bd1-acfc5358378f";

const HEADER = JSON.stringify({
  type: "session",
  version: 3,
  id: SESSION_ID,
  timestamp: "2026-09-02T07:41:50.279Z",
  cwd: "/Users/example/project",
  title: "Commit changes",
});

/** Lines OMP writes that carry no usage at all. */
const NOISE = [
  JSON.stringify({ type: "message", id: "ad331ed2", timestamp: "2026-09-02T08:31:00.000Z", message: { role: "user", content: [{ type: "text", text: "hi" }] } }), // prettier-ignore
  JSON.stringify({ type: "custom", id: "aaaa1111", timestamp: "2026-09-02T08:31:10.000Z" }),
  JSON.stringify({ type: "title_change", id: "bbbb2222", title: "Commit changes" }),
  JSON.stringify({ type: "service_tier_change", id: "cccc3333", tier: "standard" }),
  JSON.stringify({ type: "credential_pin", id: "dddd4444", hash: "REDACTED" }),
];

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prompt-burn-omp-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeTranscript(relativePath: string, lines: string[]): string {
  const path = join(root, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${lines.join("\n")}\n`);
  return path;
}

describe("parseOmpSessionFile", () => {
  it("maps the spike fixture onto a UsageEvent", () => {
    const path = writeTranscript("proj/20260902_074150_abc.jsonl", [HEADER, FIXTURE_LINE]);

    expect(parseOmpSessionFile(path)).toEqual([
      {
        id: `omp:${SESSION_ID}:566d37c8`,
        source: "omp",
        timestamp: "2026-09-02T08:31:31.505Z",
        model: "claude-opus-5",
        rawModel: "claude-opus-5",
        tokens: { input: 2, output: 105, cacheRead: 37378, cacheWrite: 463 },
        sessionId: SESSION_ID,
      },
    ]);
  });

  it("skips the header, user turns and every non-usage line type", () => {
    const path = writeTranscript("proj/session.jsonl", [HEADER, ...NOISE, FIXTURE_LINE, ...NOISE]);

    const events = parseOmpSessionFile(path);
    expect(events).toHaveLength(1);
    expect(events[0]?.tokens.output).toBe(105);
  });

  it("falls back to a file-and-offset id when the file has no header", () => {
    const path = writeTranscript("proj/headerless.jsonl", [FIXTURE_LINE, FIXTURE_LINE]);

    const [first, second] = parseOmpSessionFile(path);
    // No session uuid to scope `line.id`, so position in the file is the key.
    expect(first?.id).toMatch(/^omp:[0-9a-f]{16}$/);
    expect(first?.sessionId).toBeUndefined();
    // Two identical turns must not collapse into one id.
    expect(second?.id).not.toBe(first?.id);
    // …and the id is stable across re-reads, so a resync does not duplicate.
    expect(parseOmpSessionFile(path)[0]?.id).toBe(first?.id);
    // The tokens still land.
    expect(first?.tokens).toEqual({ input: 2, output: 105, cacheRead: 37378, cacheWrite: 463 });
  });

  it("survives blank, torn and non-object lines", () => {
    const path = writeTranscript("proj/torn.jsonl", [
      HEADER,
      "",
      "   ",
      "null",
      "42",
      FIXTURE_LINE,
      '{"type":"message","id":"ee', // a half-written last line
    ]);

    expect(parseOmpSessionFile(path)).toHaveLength(1);
  });

  it("canonicalizes the model id and keeps the raw one", () => {
    const line = FIXTURE_LINE.replace('"claude-opus-5"', '"claude-opus-5-thinking-high"');
    const path = writeTranscript("proj/aliased.jsonl", [HEADER, line]);

    expect(parseOmpSessionFile(path)[0]).toMatchObject({
      model: "claude-opus-5",
      rawModel: "claude-opus-5-thinking-high",
    });
  });

  it("returns nothing for a file that is not there", () => {
    expect(parseOmpSessionFile(join(root, "missing.jsonl"))).toEqual([]);
  });
});

describe("collectOmpEvents", () => {
  it("walks nested subagent transcripts, not just top-level sessions", () => {
    writeTranscript("proj/20260902_074150_abc.jsonl", [HEADER, FIXTURE_LINE]);
    // Subagent transcripts live in a directory named after the parent file.
    const subagentHeader = HEADER.replace(SESSION_ID, "11111111-2222-3333-4444-555555555555");
    writeTranscript("proj/20260902_074150_abc/Commit-5.jsonl", [subagentHeader, FIXTURE_LINE]);
    writeTranscript("other-proj/deep/nested/run.jsonl", [HEADER, FIXTURE_LINE]);
    // Not a transcript.
    writeTranscript("proj/notes.txt", ["ignored"]);

    const events = collectOmpEvents(root);
    expect(events).toHaveLength(3);
    expect(events.map((event) => event.sessionId)).toContain("11111111-2222-3333-4444-555555555555");
    expect(events.every((event) => event.source === "omp")).toBe(true);
  });

  it("yields nothing when OMP has never run here", () => {
    expect(collectOmpEvents(join(root, "no-such-dir"))).toEqual([]);
  });
});

describe("defaultSessionsDirectory", () => {
  it("points at OMP's own home directory, never ours", () => {
    expect(defaultSessionsDirectory("/Users/someone")).toBe(
      "/Users/someone/.omp/agent/sessions",
    );
  });
});
