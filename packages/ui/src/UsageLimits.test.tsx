/**
 * The Usage limits panel.
 *
 * The rules that matter here are honesty rules: a percentage is only shown for
 * a window that is still running, an amber row must also say "near cap" in
 * words, accounts stay anonymous, and Ollama Cloud says it has nothing rather
 * than showing a comfortable zero.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CursorSnapshot, DashboardSnapshot, ProviderLimits } from "@prompt-burn/core";
import { buildDashboardSnapshot } from "@prompt-burn/core";
import { UsageLimits, formatShortTime } from "./index.js";

afterEach(cleanup);

const NOW = new Date("2026-09-05T12:00:00.000Z");
const now = () => NOW;

/** The real cycle window, plus the plan percentages from the same response. */
const CURSOR: CursorSnapshot = {
  mode: "cycle_aggregate",
  cycleStart: "2026-08-26T07:25:29Z",
  cycleEnd: "2026-09-26T07:25:29Z",
  models: [],
  included: { autoPercentUsed: 19.575555555555553, apiPercentUsed: 32.74074074074074 },
};

/** Two Claude subscriptions, as OMP reports them: the second one near its cap. */
const CLAUDE: ProviderLimits[] = [
  {
    provider: "anthropic",
    observedAt: "2026-09-05T11:59:00.000Z",
    limits: [
      {
        id: "anthropic:5h",
        label: "Claude 5 Hour",
        windowLabel: "5 Hour",
        usedFraction: 0.38,
        resetsAt: "2026-09-05T14:20:00.000Z",
      },
      {
        id: "anthropic:7d",
        label: "Claude 7 Day",
        windowLabel: "7 Day",
        usedFraction: 0.19,
        resetsAt: "2026-09-09T08:00:00.000Z",
      },
    ],
  },
  {
    provider: "anthropic",
    observedAt: "2026-09-05T11:59:00.000Z",
    limits: [
      {
        id: "anthropic:5h",
        label: "Claude 5 Hour",
        windowLabel: "5 Hour",
        usedFraction: 0.82,
        resetsAt: "2026-09-05T16:05:00.000Z",
      },
    ],
  },
];

function snapshot(
  limits: ProviderLimits[] = CLAUDE,
  cursor: CursorSnapshot = CURSOR,
): DashboardSnapshot {
  return buildDashboardSnapshot({
    period: { kind: "today" },
    ompEvents: [],
    cursor,
    limits,
    now: NOW,
  });
}

/** The panel's own timezone is the device's, so build expectations the same way. */
function at(iso: string): string {
  return formatShortTime(iso, NOW) ?? "";
}

describe("formatShortTime", () => {
  it("names the clock at the precision the window needs", () => {
    // Later today: the time alone. Inside the week: the weekday too.
    expect(at("2026-09-05T14:20:00.000Z")).toMatch(/^\d\d:\d\d$/);
    expect(at("2026-09-09T08:00:00.000Z")).toMatch(/^[A-Z][a-z]{2} \d\d:\d\d$/);
    // Beyond the week a weekday is ambiguous, so the date is spelled out.
    expect(at("2026-09-26T08:00:00.000Z")).toMatch(/^Sep \d+, \d\d:\d\d$/);
    expect(formatShortTime("", NOW)).toBeNull();
    expect(formatShortTime("not-a-date", NOW)).toBeNull();
  });
});

describe("the usage limits panel", () => {
  it("shows one card per provider, with each account's clocks", () => {
    render(<UsageLimits snapshot={snapshot()} now={now} />);

    const card = screen.getByTestId("limit-card-anthropic");
    expect(card.textContent).toContain("Claude");
    expect(screen.getByTestId("limit-row-anthropic:5h").textContent).toBe(
      `5-hour38%resets ${at("2026-09-05T14:20:00.000Z")}`,
    );
    expect(screen.getByTestId("limit-row-anthropic:7d").textContent).toBe(
      `7-day19%resets ${at("2026-09-09T08:00:00.000Z")}`,
    );
    // Two subscriptions, no mailbox on screen.
    expect(card.textContent).toContain("Account A");
    expect(card.textContent).toContain("Account B");
    expect(card.textContent).not.toContain("@");
  });

  it("says near cap in words, not only in amber", () => {
    render(<UsageLimits snapshot={snapshot()} now={now} />);

    const card = screen.getByTestId("limit-card-anthropic");
    expect(card.textContent).toContain("Account B · near cap");
    expect(card.textContent).not.toContain("Account A · near cap");
  });

  it("refuses to report a percentage for a window that has already rolled over", () => {
    const stale: ProviderLimits[] = [
      {
        provider: "anthropic",
        observedAt: "2026-09-05T11:59:00.000Z",
        limits: [
          {
            id: "anthropic:5h",
            label: "Claude 5 Hour",
            windowLabel: "5 Hour",
            usedFraction: 0.82,
            resetsAt: "2026-09-05T09:00:00.000Z",
          },
        ],
      },
    ];

    render(<UsageLimits snapshot={snapshot(stale)} now={now} />);

    expect(screen.getByTestId("limit-row-anthropic:5h").textContent).toBe(
      "5-hour—window ended",
    );
    // An ended window is not "near cap" either — the number is simply unknown.
    expect(screen.getByTestId("limit-card-anthropic").textContent).not.toContain("near cap");
  });

  it("admits when OMP stopped refreshing the numbers", () => {
    const old = CLAUDE.slice(0, 1).map((group) => ({
      ...group,
      observedAt: "2026-09-05T09:30:00.000Z",
    }));

    render(<UsageLimits snapshot={snapshot(old)} now={now} />);

    expect(screen.getByTestId("limit-card-anthropic").textContent).toContain(
      `Account A · as of ${at("2026-09-05T09:30:00.000Z")}`,
    );
  });

  it("labels each Antigravity pool so two identical windows never read alike", () => {
    const antigravity: ProviderLimits[] = [
      {
        provider: "google-antigravity",
        observedAt: "2026-09-05T11:56:02.069Z",
        limits: [
          {
            id: "google-antigravity:google:default:gemini-5h",
            label: "Usage (Google)",
            windowLabel: "5 Hour",
            usedFraction: 0,
            resetsAt: "2026-09-05T16:56:03.000Z",
          },
          {
            id: "google-antigravity:google:default:gemini-weekly",
            label: "Usage (Google)",
            windowLabel: "Weekly",
            usedFraction: 0.064,
            resetsAt: "2026-09-11T12:46:10.000Z",
          },
        ],
      },
    ];

    render(<UsageLimits snapshot={snapshot(antigravity)} now={now} />);

    const card = screen.getByTestId("limit-card-google-antigravity");
    expect(card.textContent).toContain("Antigravity");
    expect(
      screen.getByTestId("limit-row-google-antigravity:google:default:gemini-5h").textContent,
    ).toContain("Usage (Google) · 5 Hour");
    expect(
      screen.getByTestId("limit-row-google-antigravity:google:default:gemini-weekly").textContent,
    ).toContain("Usage (Google) · Weekly6%");
  });

  it("says Ollama Cloud has no numbers rather than showing zero", () => {
    render(<UsageLimits snapshot={snapshot()} now={now} />);

    const card = screen.getByTestId("limit-card-ollama-cloud");
    expect(card.textContent).toContain("Unavailable");
    expect(card.textContent).toContain("ollama.com/settings");
    expect(card.textContent).not.toContain("0%");
  });

  it("shows Cursor's included pools against its own cycle, rounded", () => {
    render(<UsageLimits snapshot={snapshot()} now={now} />);

    const card = screen.getByTestId("limit-card-cursor");
    expect(card.textContent).toContain("This cycle · Aug 26 – Sep 26, 2026");
    expect(screen.getByTestId("limit-row-cursor-auto").textContent).toBe(
      "Auto models20%of included",
    );
    expect(screen.getByTestId("limit-row-cursor-api").textContent).toBe(
      "API models33%of included",
    );
  });

  it("disappears entirely when no provider has answered yet", () => {
    render(<UsageLimits snapshot={snapshot([], { ...CURSOR, included: undefined })} now={now} />);

    expect(screen.queryByTestId("usage-limits")).toBeNull();
  });

  it("keeps the Ollama note out of a Cursor-only panel", () => {
    render(<UsageLimits snapshot={snapshot([])} now={now} />);

    expect(screen.getByTestId("limit-card-cursor")).toBeTruthy();
    expect(screen.queryByTestId("limit-card-ollama-cloud")).toBeNull();
  });
});
