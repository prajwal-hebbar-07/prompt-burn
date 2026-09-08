/**
 * Fixture-driven mapping and request shape. The fetch is stubbed, so no live
 * Cursor API and no real token are involved: the session below is synthetic.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CursorToken } from "./index.js";
import { fetchCursorCycle, fetchCursorWindowAggregate } from "./index.js";

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

  it("reads a bare {} as no usage, and a wrong-typed aggregations as a failure", async () => {
    const { impl } = stubFetch({
      "https://cursor.com/api/dashboard/get-aggregated-usage-events": "{}",
    });
    const snapshot = await fetchCursorCycle(SESSION, impl);
    if (snapshot.mode !== "cycle_aggregate") throw new Error("expected cycle mode");
    expect(snapshot.models).toEqual([]);

    const broken = stubFetch({
      "https://cursor.com/api/dashboard/get-aggregated-usage-events": JSON.stringify({
        aggregations: { "cursor-grok-4.6-high": 1 },
      }),
    });
    await expect(fetchCursorCycle(SESSION, broken.impl)).rejects.toThrow("aggregations");
  });
});

describe("fetchCursorWindowAggregate", () => {
  const START = Date.UTC(2026, 8, 2, 0, 0, 0);
  const END = Date.UTC(2026, 8, 2, 18, 0, 0);

  it("asks Cursor for one window and maps the rows it answers with", async () => {
    const { impl, calls } = stubFetch({
      "https://cursor.com/api/dashboard/get-aggregated-usage-events": JSON.stringify({
        aggregations: [
          {
            modelIntent: "cursor-grok-4.6-high-fast",
            inputTokens: "680000",
            outputTokens: "50000",
            cacheReadTokens: "6030000",
            totalCents: 462.21,
          },
        ],
      }),
    });

    const aggregate = await fetchCursorWindowAggregate(SESSION, { start: START, end: END }, impl);

    // One call: cycle dates and plan percentages do not move with the period.
    expect(calls.map((call) => call.url)).toEqual([
      "https://cursor.com/api/dashboard/get-aggregated-usage-events",
    ]);
    // Epoch milliseconds as strings, and the individual account.
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      teamId: 0,
      startDate: String(START),
      endDate: String(END),
    });
    expect(aggregate).toEqual({
      window: { start: "2026-09-02T00:00:00.000Z", end: "2026-09-02T18:00:00.000Z" },
      // Canonicalized exactly as the cycle rows are: `-high-fast` collapses.
      models: [
        {
          model: "cursor-grok-4.6-high",
          tokens: { input: 680_000, output: 50_000, cacheRead: 6_030_000 },
        },
      ],
    });
  });

  it("answers an idle window with zero rows, still scoped to the window", async () => {
    // Cursor's own answer for a day with no usage: `200 {}`. The window must
    // survive, or the caller falls back to the cycle and the day's total
    // silently turns into a month's.
    const { impl } = stubFetch({
      "https://cursor.com/api/dashboard/get-aggregated-usage-events": "{}",
    });

    expect(await fetchCursorWindowAggregate(SESSION, { start: START, end: END }, impl)).toEqual({
      window: { start: "2026-09-02T00:00:00.000Z", end: "2026-09-02T18:00:00.000Z" },
      models: [],
    });
  });

  it("throws when Cursor refuses the window, so the caller can fall back", async () => {
    const { impl } = stubFetch({}, 400);
    await expect(
      fetchCursorWindowAggregate(SESSION, { start: START, end: END }, impl),
    ).rejects.toThrow("400");
  });
});
