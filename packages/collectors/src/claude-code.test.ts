/**
 * Synthetic Claude Code transcripts. Nothing here reads a real `~/.claude`, and
 * there is no captured fixture: the line shape is Anthropic's documented one
 * (`docs/data-shapes.md` says so too), not a redacted capture like OMP's.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectClaudeEvents,
  defaultClaudeDirectory,
  parseClaudeSessionFile,
  scanClaudeSessionFile,
} from "./index.js";

const SESSION_ID = "6f1d0a2c-6d2f-4a0b-9c34-2f3ab1c5d7e0";
const PROJECT = "/Users/example/project";

interface LineOptions {
  uuid?: string;
  messageId?: string;
  requestId?: string;
  model?: string;
  timestamp?: string;
  sessionId?: string;
}

/** One assistant turn as Claude Code writes it, with Anthropic's field names. */
function assistantLine(options: LineOptions = {}): string {
  const {
    uuid = "8b6e7d3a-1111-4c22-9d55-aaaabbbbcccc",
    messageId = "msg_01ABCDEF",
    requestId = "req_011XYZ",
    model = "claude-sonnet-4-5-20250929",
    timestamp = "2026-09-02T08:31:31.505Z",
    sessionId = SESSION_ID,
  } = options;
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    userType: "external",
    cwd: PROJECT,
    sessionId,
    version: "2.0.14",
    gitBranch: "main",
    type: "assistant",
    uuid,
    requestId,
    timestamp,
    message: {
      id: messageId,
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text: "done" }],
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 463,
        cache_read_input_tokens: 37_378,
        output_tokens: 105,
      },
    },
  });
}

/** Lines Claude Code writes that carry no billable usage. */
const NOISE = [
  JSON.stringify({ type: "user", uuid: "u1", sessionId: SESSION_ID, cwd: PROJECT, timestamp: "2026-09-02T08:31:00.000Z", message: { role: "user", content: "hi" } }), // prettier-ignore
  JSON.stringify({ type: "summary", summary: "Commit changes", leafUuid: "u1" }),
  // Locally generated, no provider call: `<synthetic>` is not a priceable model.
  JSON.stringify({ type: "assistant", uuid: "s1", sessionId: SESSION_ID, cwd: PROJECT, timestamp: "2026-09-02T08:32:00.000Z", message: { id: "msg_syn", role: "assistant", model: "<synthetic>", usage: { input_tokens: 0, output_tokens: 0 } } }), // prettier-ignore
];

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prompt-burn-claude-"));
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

describe("parseClaudeSessionFile", () => {
  it("maps an assistant turn onto a UsageEvent, skipping every other line", () => {
    const path = writeTranscript(`-Users-example-project/${SESSION_ID}.jsonl`, [
      ...NOISE,
      assistantLine(),
    ]);

    expect(parseClaudeSessionFile(path)).toEqual([
      {
        id: "claude-code:msg_01ABCDEF:req_011XYZ",
        source: "claude-code",
        timestamp: "2026-09-02T08:31:31.505Z",
        // The dated snapshot collapses onto the id the price rows key on.
        model: "claude-sonnet-4-5",
        rawModel: "claude-sonnet-4-5-20250929",
        tokens: { input: 2, output: 105, cacheRead: 37_378, cacheWrite: 463 },
        sessionId: SESSION_ID,
        // Every line carries its own cwd — there is no session header to read.
        project: PROJECT,
      },
    ]);
  });

  it("gives one API response one id however many transcripts copy it", () => {
    // Branching or resuming a session copies earlier turns into a new file with
    // fresh per-line uuids; the response ids are what stay stable.
    const original = writeTranscript("proj/a.jsonl", [assistantLine()]);
    const branched = writeTranscript("proj/b.jsonl", [
      assistantLine({ uuid: "different-line-uuid", sessionId: "another-session" }),
    ]);

    expect(parseClaudeSessionFile(original)[0]?.id).toBe(
      parseClaudeSessionFile(branched)[0]?.id,
    );
  });

  it("falls back to the line uuid when the response ids are missing", () => {
    const line = JSON.parse(assistantLine()) as Record<string, unknown>;
    delete line["requestId"];
    const path = writeTranscript("proj/c.jsonl", [JSON.stringify(line)]);

    expect(parseClaudeSessionFile(path)[0]?.id).toBe(
      `claude-code:${SESSION_ID}:8b6e7d3a-1111-4c22-9d55-aaaabbbbcccc`,
    );
  });
});

describe("scanClaudeSessionFile", () => {
  it("leaves a half-written last line unconsumed and resumes past the rest", () => {
    const path = join(root, "proj", "d.jsonl");
    mkdirSync(join(root, "proj"), { recursive: true });
    const complete = `${assistantLine()}\n`;
    writeFileSync(path, `${complete}${assistantLine({ messageId: "msg_02" }).slice(0, 40)}`);

    const first = scanClaudeSessionFile(path);
    expect(first.events).toHaveLength(1);
    expect(first.offset).toBe(Buffer.byteLength(complete, "utf8"));

    // Claude Code finishes the line; the resumed scan reads only the new one.
    writeFileSync(path, `${complete}${assistantLine({ messageId: "msg_02" })}\n`);
    const second = scanClaudeSessionFile(path, first.offset);
    expect(second.events.map((event) => event.id)).toEqual(["claude-code:msg_02:req_011XYZ"]);
  });
});

describe("collectClaudeEvents", () => {
  it("walks the project tree recursively and survives a missing directory", () => {
    writeTranscript("-Users-example-project/one.jsonl", [assistantLine()]);
    writeTranscript("-Users-example-other/two.jsonl", [
      assistantLine({ messageId: "msg_03", timestamp: "2026-09-03T08:00:00.000Z" }),
    ]);

    expect(collectClaudeEvents(root)).toHaveLength(2);
    expect(collectClaudeEvents(join(root, "nope"))).toEqual([]);
  });
});

describe("defaultClaudeDirectory", () => {
  it("uses ~/.claude/projects, and CLAUDE_CONFIG_DIR when it is set", () => {
    expect(defaultClaudeDirectory("/home/example", {})).toBe("/home/example/.claude/projects");
    expect(defaultClaudeDirectory("/home/example", { CLAUDE_CONFIG_DIR: "/cfg/claude" })).toBe(
      "/cfg/claude/projects",
    );
  });
});
