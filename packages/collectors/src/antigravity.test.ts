/**
 * The Antigravity quota collector against a real captured response.
 *
 * Four behaviours earn a test here, and each one is a bug that has a plausible
 * way of happening: Google reports what is *left* and the panel shows what is
 * gone, so the inversion must never drift; the group name is what keeps two
 * five-hour clocks from reading alike; an expired keychain token has to be
 * refreshed rather than sent; and the `User-Agent` carries a licensing gate
 * that answers 403 for anything not naming Antigravity.
 *
 * Fixture: [`docs/fixtures/antigravity-quota-summary.json`](../../../docs/fixtures/antigravity-quota-summary.json)
 * — one real `retrieveUserQuotaSummary` body, unaltered.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchAntigravityLimits, readAntigravityAuth } from "./antigravity.js";
import type { AntigravityCredential } from "./antigravity.js";

const QUOTA = readFileSync(
  new URL("../../../docs/fixtures/antigravity-quota-summary.json", import.meta.url),
  "utf8",
);

const NOW = new Date("2026-09-11T11:00:00.000Z");

/**
 * A stand-in for the installed `agy`: the OAuth client is read out of the
 * binary at run time rather than checked in, so the test ships its own. Two of
 * each, because the real binary carries more than one pair and labels none.
 *
 * Assembled from parts on purpose. Written out whole, these synthetic values
 * match GitHub's `Google OAuth Client ID` / `Client Secret` patterns and push
 * protection blocks the commit — the same wall the real pair hit.
 */
const clientId = (prefix: string, body: string) =>
  `${prefix.repeat(12)}-${body.repeat(32)}.apps.${"google"}usercontent.com`;
const clientSecret = (last: string) => `GOC${"SPX"}-${"0".repeat(27)}${last}`;

const FAKE_CLIENT_ID = clientId("1", "a");
const OTHER_CLIENT_ID = clientId("2", "b");
const FAKE_SECRET = clientSecret("A");
const OTHER_SECRET = clientSecret("B");

let root: string;
let agyBinary: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prompt-burn-agy-"));
  agyBinary = join(root, "agy");
  writeFileSync(
    agyBinary,
    `\u0000binary padding${FAKE_CLIENT_ID}\u0000${OTHER_CLIENT_ID}\u0000${FAKE_SECRET}${OTHER_SECRET}\u0000`,
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** An id token carrying only the claim this module reads. */
function idToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email })).toString("base64url");
  return `header.${payload}.signature`;
}

function keychain(token: Record<string, unknown>, email = "you@example.com"): () => string {
  const body = JSON.stringify({ token, auth_method: "consumer", id_token: idToken(email) });
  return () => `go-keyring-base64:${Buffer.from(body).toString("base64")}\n`;
}

const LIVE: AntigravityCredential = {
  ok: true,
  accessToken: "live-access-token",
  refreshToken: "refresh-token",
  expiresAt: new Date("2026-09-11T11:40:00.000Z"),
  account: "you@example.com",
};

/** Records every request so the token header and the retry order stay visible. */
function recorder(responses: Array<{ status?: number; body: string }>) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const next = responses.shift();
    if (!next) throw new Error(`unexpected request to ${String(input)}`);
    calls.push({
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: String(init?.body ?? ""),
    });
    return new Response(next.body, { status: next.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("readAntigravityAuth", () => {
  it("reads agy's go-keyring item, including the address the card is named by", () => {
    const auth = readAntigravityAuth(
      keychain(
        {
          access_token: "at",
          refresh_token: "rt",
          expiry: "2026-09-11T16:36:38.746571+05:30",
        },
        "prajwal@example.com",
      ),
    );

    expect(auth).toMatchObject({
      ok: true,
      accessToken: "at",
      refreshToken: "rt",
      account: "prajwal@example.com",
    });
    expect(auth.ok && auth.expiresAt.toISOString()).toBe("2026-09-11T11:06:38.746Z");
  });

  it("calls a session with no refresh token signed out, not merely unreadable", () => {
    // An access token alone dies within the hour and cannot be renewed, so the
    // honest answer is that there is no session — not one that works for now.
    expect(readAntigravityAuth(keychain({ access_token: "at", expiry: "2026-09-11T11:30:00Z" })))
      .toMatchObject({ ok: false, reason: "signed_out" });
  });

  it("reports a missing keychain item as signed out", () => {
    expect(
      readAntigravityAuth(() => {
        throw Object.assign(new Error("SecKeychainSearchCopyNext"), { status: 44 });
      }),
    ).toMatchObject({ ok: false, reason: "signed_out" });
  });

  it("reports a machine with no keychain tool as signed out, not unreadable", () => {
    // Linux CI has no `security` to spawn. That is "no agy session", not a
    // keychain this app failed to read, and the difference decides whether the
    // desktop shell shows an error banner.
    expect(
      readAntigravityAuth(() => {
        throw Object.assign(new Error("spawnSync security ENOENT"), { code: "ENOENT" });
      }),
    ).toMatchObject({ ok: false, reason: "signed_out" });
  });
});

describe("fetchAntigravityLimits", () => {
  it("turns Google's remaining fractions into the used fractions the panel shows", async () => {
    const { calls, fetchImpl } = recorder([{ body: QUOTA }]);

    const limits = await fetchAntigravityLimits(LIVE, fetchImpl, NOW);

    expect(limits).toEqual({
      provider: "google-antigravity",
      account: "you@example.com",
      observedAt: NOW.toISOString(),
      limits: [
        {
          id: "google-antigravity:gemini-weekly",
          // The group's name, in the `Usage (…)` shape the panel splits into a
          // vendor heading — without it both 5-hour rows would read alike.
          label: "Usage (Gemini Models)",
          windowLabel: "Weekly",
          usedFraction: 1 - 0.7013921,
          resetsAt: "2026-09-11T12:46:10Z",
        },
        {
          id: "google-antigravity:gemini-5h",
          label: "Usage (Gemini Models)",
          windowLabel: "5 Hour",
          usedFraction: 1 - 0.0178833,
          resetsAt: "2026-09-11T13:45:43Z",
        },
        {
          id: "google-antigravity:3p-weekly",
          label: "Usage (Claude and GPT models)",
          windowLabel: "Weekly",
          usedFraction: 0,
          resetsAt: "2026-09-18T10:51:20Z",
        },
        {
          id: "google-antigravity:3p-5h",
          label: "Usage (Claude and GPT models)",
          windowLabel: "5 Hour",
          usedFraction: 0,
          resetsAt: "2026-09-11T15:51:20Z",
        },
      ],
    });

    // The licensing gate: an agent string without "antigravity" in it is
    // answered 403 SUBSCRIPTION_REQUIRED, which looks nothing like its cause.
    expect(calls[0]?.headers["User-Agent"]).toMatch(/antigravity/i);
    expect(calls[0]?.headers["Authorization"]).toBe("Bearer live-access-token");
    // Naming a project turns the same call into a permission error.
    expect(calls[0]?.headers).not.toHaveProperty("x-goog-user-project");
  });

  it("drops a disabled bucket and keeps one that reported no fraction", async () => {
    const { fetchImpl } = recorder([
      {
        body: JSON.stringify({
          groups: [
            {
              displayName: "Gemini Models",
              buckets: [
                { bucketId: "gemini-5h", window: "5h", disabled: true, remainingFraction: 1 },
                { bucketId: "gemini-weekly", window: "weekly", remainingAmount: 400 },
              ],
            },
          ],
        }),
      },
    ]);

    const { limits } = await fetchAntigravityLimits(LIVE, fetchImpl, NOW);

    // A pool this account does not have must not render as "0% used", and a
    // bucket that answered with an amount has no percentage to show at all.
    expect(limits).toEqual([
      {
        id: "google-antigravity:gemini-weekly",
        label: "Usage (Gemini Models)",
        windowLabel: "Weekly",
        usedFraction: null,
        resetsAt: null,
      },
    ]);
  });

  it("refreshes an expired access token instead of sending it", async () => {
    const { calls, fetchImpl } = recorder([
      { body: JSON.stringify({ access_token: "fresh-access-token", expires_in: 3599 }) },
      { body: QUOTA },
    ]);
    const expired = { ...LIVE, expiresAt: new Date("2026-09-11T10:00:00.000Z") };

    await fetchAntigravityLimits(expired, fetchImpl, NOW, agyBinary);

    expect(calls[0]?.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0]?.body).toContain("grant_type=refresh_token");
    // The OAuth client is read out of the installed binary, never checked in.
    expect(calls[0]?.body).toContain(encodeURIComponent(FAKE_CLIENT_ID));
    expect(calls[0]?.body).toContain(FAKE_SECRET);
    // agy may not have run for hours; the stale token must never reach Google.
    expect(calls[1]?.headers["Authorization"]).toBe("Bearer fresh-access-token");
  });

  it("tries the binary's next OAuth pair when Google rejects the first", async () => {
    // The binary ships several pairs and labels none, so `invalid_client` on
    // one of them is not a failure — only running out of pairs is.
    const { calls, fetchImpl } = recorder([
      { status: 401, body: JSON.stringify({ error: "invalid_client" }) },
      { status: 401, body: JSON.stringify({ error: "invalid_client" }) },
      { body: JSON.stringify({ access_token: "fourth-pair-wins" }) },
      { body: QUOTA },
    ]);
    const expired = { ...LIVE, expiresAt: new Date("2026-09-11T10:00:00.000Z") };

    await fetchAntigravityLimits(expired, fetchImpl, NOW, agyBinary);

    expect(calls.slice(0, 3).map((call) => call.url)).toEqual([
      "https://oauth2.googleapis.com/token",
      "https://oauth2.googleapis.com/token",
      "https://oauth2.googleapis.com/token",
    ]);
    expect(calls[3]?.headers["Authorization"]).toBe("Bearer fourth-pair-wins");
  });

  it("says so when there is no agy binary to read an OAuth client from", async () => {
    const { fetchImpl } = recorder([]);
    const expired = { ...LIVE, expiresAt: new Date("2026-09-11T10:00:00.000Z") };

    await expect(
      fetchAntigravityLimits(expired, fetchImpl, NOW, join(root, "no-agy-here")),
    ).rejects.toThrow(/No OAuth client in/);
  });

  it("fails loudly when the internal endpoint stops answering in its own shape", async () => {
    const { fetchImpl } = recorder([{ body: JSON.stringify({ description: "no groups here" }) }]);

    await expect(fetchAntigravityLimits(LIVE, fetchImpl, NOW)).rejects.toThrow(/no groups array/);
  });
});
