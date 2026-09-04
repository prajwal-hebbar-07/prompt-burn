/**
 * The sidecar's stdin/stdout protocol, exercised against the real Node
 * process: a fake HOME, a fake OMP sessions directory, and a synthetic
 * transcript built from the spike fixture. Neither a real `~/.prompt-burn` nor
 * a real `~/.omp` is touched.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const SIDECAR = fileURLToPath(new URL("./index.ts", import.meta.url));
const RESOLVE_HOOK = fileURLToPath(new URL("./ts-resolve.mjs", import.meta.url));
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
});

/** The fixture message with a different per-file line id. */
function messageLine(id: string): string {
  return FIXTURE_LINE.replace('"566d37c8"', JSON.stringify(id));
}

/** Reads stdout lines as they arrive; each call resolves one protocol line. */
function lineQueue(stdout: Readable): () => Promise<string> {
  stdout.setEncoding("utf8");
  const pending: string[] = [];
  const waiting: Array<(line: string) => void> = [];
  let buffered = "";
  stdout.on("data", (chunk: string) => {
    buffered += chunk;
    let newline = buffered.indexOf("\n");
    while (newline >= 0) {
      const line = buffered.slice(0, newline);
      buffered = buffered.slice(newline + 1);
      const waiter = waiting.shift();
      if (waiter) waiter(line);
      else pending.push(line);
      newline = buffered.indexOf("\n");
    }
  });
  return () => {
    const { promise, resolve } = Promise.withResolvers<string>();
    const line = pending.shift();
    if (line !== undefined) resolve(line);
    else waiting.push(resolve);
    return promise;
  };
}

/** A running sidecar: send requests, take responses in arrival order. */
class Sidecar {
  private nextId = 0;
  private readonly takeLine: () => Promise<string>;

  constructor(
    private readonly child: ChildProcess,
    private readonly stdin: Writable,
    takeLine: () => Promise<string>,
  ) {
    this.takeLine = takeLine;
  }

  async ready(database: string): Promise<void> {
    const line = JSON.parse(await this.takeLine()) as { type: string; database: string };
    expect(line.type).toBe("ready");
    expect(line.database).toBe(database);
  }

  async request(method: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    this.stdin.write(`${JSON.stringify({ id, method, ...extra })}\n`);
    const response = JSON.parse(await this.takeLine()) as Record<string, unknown>;
    // Responses arrive in request order; the id check would catch a mix-up.
    expect(response["id"]).toBe(id);
    return response;
  }

  exit(): Promise<number | null> {
    const { promise, resolve } = Promise.withResolvers<number | null>();
    this.child.once("exit", resolve);
    this.stdin.end();
    return promise;
  }
}

let current: Sidecar | undefined;

/** Boots the sidecar against a throwaway home; the caller closes it. */
async function boot(home: string): Promise<Sidecar> {
  const child = spawn(process.execPath, ["--import", RESOLVE_HOOK, SIDECAR], {
    env: { ...process.env, HOME: home },
    stdio: ["pipe", "pipe", "inherit"],
  });
  if (!child.stdin || !child.stdout) throw new Error("stdio was piped");
  const sidecar = new Sidecar(child, child.stdin, lineQueue(child.stdout));
  current = sidecar;
  await sidecar.ready(join(home, ".prompt-burn", "db.sqlite"));
  return sidecar;
}

/** A fake OMP install under `home`, with one two-message transcript. */
function fakeOmpSessions(home: string): string {
  const sessions = join(home, ".omp", "agent", "sessions");
  mkdirSync(join(sessions, "proj"), { recursive: true });
  writeFileSync(
    join(sessions, "proj", "20260902_074150_abc.jsonl"),
    `${[HEADER, messageLine("aaaa0001"), messageLine("bbbb0002")].join("\n")}\n`,
  );
  return sessions;
}

async function withSidecar(test: (sidecar: Sidecar, home: string) => Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), "prompt-burn-reader-"));
  try {
    await test(await boot(home), home);
  } finally {
    await current?.exit();
    current = undefined;
    rmSync(home, { recursive: true, force: true });
  }
}

it("reports OMP health and the absent Cursor collector via discover", async () => {
  await withSidecar(async (sidecar, home) => {
    const sessions = fakeOmpSessions(home);

    const response = await sidecar.request("discover");
    expect(response["ok"]).toBe(true);
    expect(response["result"]).toEqual([
      { source: "omp", available: true, detail: sessions },
      { source: "cursor", available: false, detail: "No Cursor collector yet — lands with the Cursor phase." },
    ]);
  });
});

it("fetch syncs OMP transcripts incrementally", async () => {
  await withSidecar(async (sidecar, home) => {
    fakeOmpSessions(home);

    const first = await sidecar.request("fetch");
    expect(first["ok"]).toBe(true);
    expect(first["result"]).toEqual({
      at: expect.any(String),
      ok: true,
      omp: { scannedFiles: 1, skippedFiles: 0, insertedEvents: 2 },
    });

    // Nothing changed on disk: the second sync opens no file (one transcript).
    const second = await sidecar.request("fetch");
    expect(second["result"]).toMatchObject({
      ok: true,
      omp: { scannedFiles: 0, skippedFiles: 1, insertedEvents: 0 },
    });
  });
});

it("getSnapshot(all_time) aggregates synced OMP rows through core", async () => {
  await withSidecar(async (sidecar, home) => {
    fakeOmpSessions(home);
    await sidecar.request("fetch");

    const response = await sidecar.request("getSnapshot", { period: { kind: "all_time" } });
    expect(response["ok"]).toBe(true);
    // The fixture line twice: input 2, output 105, cacheRead 37378, cacheWrite 463.
    expect(response["result"]).toMatchObject({
      period: { kind: "all_time" },
      estimatedCents: null, // pricing is not wired into the aggregate yet
      omp: { estimatedCents: null, tokens: { input: 4, output: 210, cacheRead: 74756, cacheWrite: 926 } },
      cursor: { mode: "cycle_aggregate", estimatedCents: null, tokens: { input: 0, output: 0 } },
      models: [
        {
          source: "omp",
          model: "claude-opus-5",
          estimatedCents: null,
          tokens: { input: 4, output: 210, cacheRead: 74756, cacheWrite: 926 },
        },
      ],
      mixedPeriod: false,
      fetch: { lastSuccessAt: null, status: "idle" },
    });
  });
});

it("a vanished or broken OMP source syncs zero rows, not an error", async () => {
  await withSidecar(async (sidecar, home) => {
    const sessions = fakeOmpSessions(home);
    await sidecar.request("fetch");

    // Break the source: readdir on a file path throws, and the sync's own
    // contract says a broken source is zeros, not a fetch error.
    rmSync(sessions, { recursive: true, force: true });
    writeFileSync(sessions, "not a directory");

    const result = await sidecar.request("fetch");
    expect(result["ok"]).toBe(true);
    expect(result["result"]).toMatchObject({
      ok: true,
      omp: { scannedFiles: 0, skippedFiles: 0, insertedEvents: 0 },
    });

    // The stored rows are untouched and still aggregate.
    const snapshot = await sidecar.request("getSnapshot", { period: { kind: "all_time" } });
    expect(snapshot["ok"]).toBe(true);
    expect(snapshot["result"]).toMatchObject({
      omp: { tokens: { input: 4, output: 210 } },
    });
  });
});

it("answers an unknown method with an error response, not an exit", async () => {
  await withSidecar(async (sidecar) => {
    const response = await sidecar.request("nonsense");
    expect(response["ok"]).toBe(false);
    expect(response["error"]).toContain("nonsense");

    // The process stays up and usable.
    expect((await sidecar.request("discover"))["ok"]).toBe(true);
  });
});