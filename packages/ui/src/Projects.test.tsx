/**
 * The Projects route. Two things can go wrong quietly: two checkouts sharing a
 * basename rendering as the same heading, and usage from a headerless
 * transcript disappearing instead of landing in its own bucket.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buildDashboardSnapshot, type UsageEvent } from "@prompt-burn/core";
import { Projects, UNATTRIBUTED, projectLabel } from "./index.js";

afterEach(cleanup);

const CURSOR = {
  mode: "cycle_aggregate" as const,
  cycleStart: "2026-08-26T07:25:29Z",
  cycleEnd: "2026-09-26T07:25:29Z",
  models: [{ model: "default", tokens: { input: 10, output: 10 } }],
};

function event(id: string, model: string, project?: string): UsageEvent {
  return {
    id,
    source: "omp",
    timestamp: "2026-09-02T08:31:31.505Z",
    model,
    rawModel: model,
    tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 },
    ...(project ? { project } : {}),
  };
}

const snapshot = (events: UsageEvent[]) =>
  buildDashboardSnapshot({
    period: { kind: "all_time" },
    ompEvents: events,
    cursor: CURSOR,
    priceCents: (_model, tokens) => tokens.output,
  });

describe("projectLabel", () => {
  it("shows the basename, widened only where two projects collide", () => {
    const all = ["/Users/me/work/api", "/Users/me/personal/api", "/Users/me/prompt-burn"];
    expect(projectLabel("/Users/me/prompt-burn", all)).toBe("prompt-burn");
    expect(projectLabel("/Users/me/work/api", all)).toBe("work/api");
    expect(projectLabel("/Users/me/personal/api", all)).toBe("personal/api");
    expect(projectLabel(null)).toBe(UNATTRIBUTED);
  });
});

describe("Projects", () => {
  it("gives each project its own card with the models it used", () => {
    render(
      <Projects
        snapshot={snapshot([
          event("1", "claude-opus-5", "/w/api"),
          event("2", "glm-5.3-flash", "/w/api"),
          event("3", "glm-5.3-flash", "/w/web"),
        ])}
      />,
    );

    const api = screen.getByTestId("project-/w/api");
    expect(api.textContent).toContain("2 models");
    expect(api.querySelector('[data-testid="model-row-omp-claude-opus-5"]')).not.toBeNull();
    expect(api.querySelector('[data-testid="model-row-omp-glm-5.3-flash"]')).not.toBeNull();

    const web = screen.getByTestId("project-/w/web");
    // The other project's model never leaks into this card.
    expect(web.querySelector('[data-testid="model-row-omp-claude-opus-5"]')).toBeNull();

    // Cursor has a cycle in this snapshot and still gets no card of its own.
    expect(screen.queryByTestId("project-cursor")).toBeNull();
    expect(screen.getByTestId("projects-note").textContent).toContain("Cursor reports none");
  });

  it("keeps usage from a headerless transcript in its own bucket", () => {
    render(<Projects snapshot={snapshot([event("1", "claude-opus-5")])} />);

    const bucket = screen.getByTestId("project-unattributed");
    expect(bucket.textContent).toContain(UNATTRIBUTED);
    expect(bucket.querySelector('[data-testid="model-row-omp-claude-opus-5"]')).not.toBeNull();
  });

  it("says so when the period holds no OMP usage at all", () => {
    render(<Projects snapshot={snapshot([])} />);

    expect(screen.getByTestId("projects-empty").textContent).toContain("nothing to break down");
  });
});
