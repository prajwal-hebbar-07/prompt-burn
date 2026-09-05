/**
 * Fixture-driven mapping and request shape. The fetch is stubbed, so no live
 * Cursor API and no real token are involved: the session below is synthetic.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CursorToken } from "./index.js";
import { fetchCursorCycle } from "./index.js";

const SUMMARY = readFileSync(
  new URL("../../../docs/fixtures/cursor-usage-summary.json", import.meta.url),
  "utf8",
);
const AGGREGATES = readFileSync(
  new URL("../../../docs/fixtures/cursor-cycle-aggregates.json", import.meta.url),
  "utf8",
);

const SESSION: CursorToken = {
  ok: true,
  token: "header.payload.signature",
  userId: "user_01SYNTHETIC|colon",
  expiresAt: new Date("2027-01-01T00:00:00Z"),
};

interface Call {
  url: string;
  init: RequestInit;
}

/** Serves the two fixtures by path and records what was asked for. */
function stubFetch(bodies: Record<string, string> = {}, status = 200) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const href = String(url);
    calls.push({ url: href, init });
    const body = bodies[href] ?? (href.endsWith("/api/usage-summary") ? SUMMARY : AGGREGATES);
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("fetchCursorCycle", () => {
  it("maps the spike fixtures onto a cycle_aggregate snapshot", async () => {
    const { impl } = stubFetch();
    const snapshot = await fetchCursorCycle(SESSION, impl);

    expect(snapshot).toEqual({
      mode: "cycle_aggregate",
      cycleStart: "2026-08-26T07:25:29.000Z",
      cycleEnd: "2026-09-26T07:25:29.000Z",
      included: {
        autoPercentUsed: 19.575555555555553,
        apiPercentUsed: 32.74074074074074,
      },
      models: [
        {
          model: "cursor-grok-4.6-high",
          tokens: { input: 9_290_000, output: 1_110_000, cacheRead: 94_300_000 },
        },
        {
          model: "claude-opus-5",
          tokens: { input: 164, output: 82_300, cacheRead: 7_350_000, cacheWrite: 778_000 },
        },
        {
          model: "default",
          tokens: { input: 3_200_000, output: 219_000, cacheRead: 16_700_000 },
        },
        {
          model: "cursor-grok-4.6-high",
          tokens: { input: 254_000, output: 57_800, cacheRead: 4_830_000 },
        },
        {
          model: "cursor-grok-4.5-high",
          tokens: { input: 262_000, output: 24_400, cacheRead: 1_510_000 },
        },
        {
          model: "gpt-5.6-sol-medium",
          tokens: { input: 3, output: 4_060, cacheWrite: 74_400 },
        },
      ],
    });
  });

  it("omits cache keys Cursor omitted instead of inventing zero", async () => {
    const { impl } = stubFetch();
    const snapshot = await fetchCursorCycle(SESSION, impl);
    if (snapshot.mode !== "cycle_aggregate") throw new Error("expected cycle mode");

    const grok = snapshot.models[0]?.tokens;
    const gpt = snapshot.models[5]?.tokens;
    expect(grok && "cacheWrite" in grok).toBe(false);
    expect(gpt && "cacheRead" in gpt).toBe(false);
  });

  it("never carries Cursor's own cents or tier into the snapshot", async () => {
    const { impl } = stubFetch();
    const snapshot = JSON.stringify(await fetchCursorCycle(SESSION, impl));

    expect(snapshot).not.toContain("9914.55");
    expect(snapshot).not.toContain("7048.46");
    expect(snapshot).not.toContain("Cents");
    expect(snapshot).not.toContain("tier");
  });

  it("posts both endpoints with the session cookie, Origin and an empty body", async () => {
    const { impl, calls } = stubFetch();
    await fetchCursorCycle(SESSION, impl);

    expect(calls.map((call) => call.url)).toEqual([
      "https://cursor.com/api/usage-summary",
      "https://cursor.com/api/dashboard/get-aggregated-usage-events",
    ]);
    for (const { init } of calls) {
      const headers = init.headers as Record<string, string>;
      expect(init.method).toBe("POST");
      // Cursor rejects state-changing calls without it: 403 Invalid origin.
      expect(headers.Origin).toBe("https://cursor.com");
      expect(headers.Cookie).toBe(
        `WorkosCursorSessionToken=${encodeURIComponent(SESSION.userId)}%3A%3A${SESSION.token}`,
      );
      expect(headers.Authorization).toBeUndefined();
      // `{}` = current billing cycle. No date window, no teamId.
      expect(init.body).toBe("{}");
    }
  });

  it("throws on a non-ok response", async () => {
    const { impl } = stubFetch({}, 403);
    await expect(fetchCursorCycle(SESSION, impl)).rejects.toThrow("403");
  });

  it("throws when usage-summary has no cycle window", async () => {
    const { impl } = stubFetch({ "https://cursor.com/api/usage-summary": "{}" });
    await expect(fetchCursorCycle(SESSION, impl)).rejects.toThrow("billing cycle window");
  });

  it("carries the plan percentages, and nothing else about the plan", async () => {
    const { impl } = stubFetch();
    const snapshot = await fetchCursorCycle(SESSION, impl);
    if (snapshot.mode !== "cycle_aggregate") throw new Error("expected cycle mode");

    expect(snapshot.included).toEqual({
      autoPercentUsed: 19.575555555555553,
      apiPercentUsed: 32.74074074074074,
    });
    // The credit pool, the bonus grant and Cursor's display sentences stay out:
    // two percentages are the whole of what the limits panel shows.
    const json = JSON.stringify(snapshot);
    expect(json).not.toContain("7914");
    expect(json).not.toContain("You've used");
  });

  it("omits the percentages when Cursor answers without a personal plan", async () => {
    const { impl } = stubFetch({
      "https://cursor.com/api/usage-summary": JSON.stringify({
        billingCycleStart: "2026-08-26T07:25:29.000Z",
        billingCycleEnd: "2026-09-26T07:25:29.000Z",
        teamUsage: {},
      }),
    });
    const snapshot = await fetchCursorCycle(SESSION, impl);
    if (snapshot.mode !== "cycle_aggregate") throw new Error("expected cycle mode");

    expect(snapshot.included).toBeUndefined();
  });

  it("throws when the aggregate response has no aggregations", async () => {
    const { impl } = stubFetch({
      "https://cursor.com/api/dashboard/get-aggregated-usage-events": "{}",
    });
    await expect(fetchCursorCycle(SESSION, impl)).rejects.toThrow("aggregations");
  });
});
