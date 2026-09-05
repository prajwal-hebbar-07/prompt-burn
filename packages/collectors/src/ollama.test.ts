/**
 * The Ollama Cloud clocks, offline: the real `/api/usage` payload as a fixture
 * and a synthetic OMP credential store.
 *
 * The endpoint is undocumented, so the shape checks matter more than usual —
 * a payload that changes must degrade to a thrown error the orchestrator can
 * report, never to a plausible-looking zero.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { fetchOllamaLimits, readOllamaKey } from "./ollama.js";

const USAGE = readFileSync(
  new URL("../../../docs/fixtures/ollama-usage.json", import.meta.url),
  "utf8",
);

const KEY = "synthetic-ollama-key";
const roots: string[] = [];

interface Credential {
  provider?: string;
  key?: string;
  disabled?: string;
}

/** OMP's credential store, as `ollama login` leaves it. */
function agentDatabase(credentials: Credential[]): string {
  const root = mkdtempSync(join(tmpdir(), "prompt-burn-ollama-"));
  roots.push(root);
  const file = join(root, "agent.db");
  const db = new DatabaseSync(file);
  db.exec(
    `CREATE TABLE auth_credentials (
       id INTEGER PRIMARY KEY AUTOINCREMENT, provider TEXT NOT NULL,
       credential_type TEXT NOT NULL, data TEXT NOT NULL,
       disabled_cause TEXT DEFAULT NULL, identity_key TEXT DEFAULT NULL,
       created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)`,
  );
  const insert = db.prepare(
    `INSERT INTO auth_credentials (provider, credential_type, data, disabled_cause, updated_at)
     VALUES (?, 'api_key', ?, ?, 1)`,
  );
  for (const credential of credentials) {
    insert.run(
      credential.provider ?? "ollama-cloud",
      JSON.stringify({ key: credential.key ?? KEY, source: "login" }),
      credential.disabled ?? null,
    );
  }
  db.close();
  return file;
}

/** One request, whatever the URL: this collector calls exactly one endpoint. */
function stubFetch(body = USAGE, status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("readOllamaKey", () => {
  it("finds the key OMP stored at login", () => {
    expect(readOllamaKey(agentDatabase([{}]))).toBe(KEY);
  });

  it("has nothing to find without an OMP install, a login, or a live credential", () => {
    expect(readOllamaKey(join(tmpdir(), "prompt-burn-absent", "agent.db"))).toBeUndefined();
    expect(readOllamaKey(agentDatabase([{ provider: "anthropic" }]))).toBeUndefined();
    expect(readOllamaKey(agentDatabase([{ disabled: "revoked" }]))).toBeUndefined();
  });
});

describe("fetchOllamaLimits", () => {
  it("maps the two clocks and sends the key as a bearer token", async () => {
    const { impl, calls } = stubFetch();
    const limits = await fetchOllamaLimits(KEY, impl);

    expect(calls[0]?.url).toBe("https://ollama.com/api/usage");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(limits).toMatchObject({
      provider: "ollama-cloud",
      limits: [
        {
          id: "ollama-cloud:session",
          label: "Ollama Cloud Session",
          windowLabel: "Session",
          usedFraction: 0.037,
          // Ollama sends no reset instant, and one is never invented.
          resetsAt: null,
        },
        {
          id: "ollama-cloud:weekly",
          label: "Ollama Cloud Weekly",
          windowLabel: "Weekly",
          usedFraction: 0.358,
          resetsAt: null,
        },
      ],
    });
    expect(Number.isNaN(Date.parse(limits.observedAt))).toBe(false);
  });

  it("carries neither Ollama's own cost nor its per-model request counts", async () => {
    const { impl } = stubFetch();
    const json = JSON.stringify(await fetchOllamaLimits(KEY, impl));

    expect(json).not.toContain("cost");
    expect(json).not.toContain("request_count");
    expect(json).not.toContain("1753");
  });

  it("throws on a dead key, so the pass reports it instead of showing zero", async () => {
    const { impl } = stubFetch('{"error":"unauthorized"}', 401);
    await expect(fetchOllamaLimits(KEY, impl)).rejects.toThrow("401");
  });

  it("throws when the undocumented payload stops carrying clocks", async () => {
    await expect(fetchOllamaLimits(KEY, stubFetch("{}").impl)).rejects.toThrow("no limits object");
    await expect(
      fetchOllamaLimits(KEY, stubFetch('{"limits":{"session":{}}}').impl),
    ).rejects.toThrow("neither a session nor a weekly clock");
  });

  it("keeps a single clock rather than dropping the whole card", async () => {
    const { impl } = stubFetch('{"limits":{"weekly":{"usage":1.4}}}');
    const limits = await fetchOllamaLimits(KEY, impl);

    // Clamped: a provider over its own ceiling has simply run out.
    expect(limits.limits).toEqual([
      {
        id: "ollama-cloud:weekly",
        label: "Ollama Cloud Weekly",
        windowLabel: "Weekly",
        usedFraction: 1,
        resetsAt: null,
      },
    ]);
  });
});
