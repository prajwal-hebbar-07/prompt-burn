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

/** The same shape, read from the Claude Code CLI's own transcripts. */
function claudeEvent(id: string, model: string, project?: string): UsageEvent {
  return { ...event(id, model, project), source: "claude-code" };
}

/** The same shape again, from an `agy` conversation's workspace path. */
function agyEvent(id: string, model: string, project?: string): UsageEvent {
  return { ...event(id, model, project), source: "antigravity" };
}

const snapshot = (
  events: UsageEvent[],
  claudeEvents: UsageEvent[] = [],
  antigravityEvents: UsageEvent[] = [],
) =>
  buildDashboardSnapshot({
    period: { kind: "all_time" },
    ompEvents: events,
    claudeEvents,
    antigravityEvents,
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

  it("renders a top-level Ring / Donut graph overview when multiple projects exist", () => {
    render(
      <Projects
        snapshot={snapshot([
          event("1", "claude-opus-5", "/w/api"),
          event("2", "glm-5.3-flash", "/w/web"),
        ])}
      />,
    );

    const overview = screen.getByTestId("projects-overview");
    expect(overview.textContent).toContain("2 projects");
    expect(overview.textContent).toContain("Project Overview");
    expect(overview.textContent).toContain("Total burn");

    // The SVG Donut / Ring Chart
    const ringSvg = screen.getByRole("img", { name: "Project spend distribution ring" });
    expect(ringSvg).toBeTruthy();
    // Circle elements for track + 2 project slices
    expect(ringSvg.querySelectorAll("circle").length).toBe(3);
  });

  it("renders Gantt-style model lanes inside each project card", () => {
    render(
      <Projects
        snapshot={snapshot([
          event("1", "claude-opus-5", "/w/api"),
          event("2", "glm-5.3-flash", "/w/api"),
        ])}
      />,
    );

    const api = screen.getByTestId("project-/w/api");
    const ganttLane = api.querySelector('[role="img"]');
    expect(ganttLane).toBeTruthy();
    expect(ganttLane?.getAttribute("aria-label")).toContain("Model usage breakdown");
  });

  it("omits the overview bar when there is only one project", () => {
    render(<Projects snapshot={snapshot([event("1", "claude-opus-5", "/w/api")])} />);

    expect(screen.queryByTestId("projects-overview")).toBeNull();
  });

  it("keeps usage from a headerless transcript in its own bucket", () => {
    render(<Projects snapshot={snapshot([event("1", "claude-opus-5")])} />);

    const bucket = screen.getByTestId("project-unattributed");
    expect(bucket.textContent).toContain(UNATTRIBUTED);
    expect(bucket.querySelector('[data-testid="model-row-omp-claude-opus-5"]')).not.toBeNull();
  });

  it("counts Claude Code working directories beside OMP's, and says both are here", () => {
    render(
      <Projects
        snapshot={snapshot(
          [event("1", "claude-opus-5", "/w/api")],
          [claudeEvent("2", "claude-opus-5", "/w/cli")],
        )}
      />,
    );

    const cli = screen.getByTestId("project-/w/cli");
    expect(
      cli.querySelector('[data-testid="model-row-claude-code-claude-opus-5"]'),
    ).not.toBeNull();
    expect(screen.getByTestId("projects-note").textContent).toContain(
      "Projects are OMP, Claude Code and Antigravity working directories",
    );
  });

  it("attributes an agy conversation to its workspace, pill and all", () => {
    render(
      <Projects
        snapshot={snapshot(
          [event("1", "claude-opus-5", "/w/api")],
          [],
          [agyEvent("2", "gemini-3.8-flash", "/w/agy")],
        )}
      />,
    );

    const card = screen.getByTestId("project-/w/agy");
    expect(
      card.querySelector('[data-testid="model-row-antigravity-gemini-3.8-flash"]'),
    ).not.toBeNull();
    // Colour with wording, and the source token — never the quota tile's blue.
    expect(card.textContent).toContain("Antigravity");
    expect(card.innerHTML).toContain("text-source-antigravity");
    expect(card.innerHTML).not.toContain("provider-antigravity");
    // Cursor's absence is still explained, unchanged.
    expect(screen.getByTestId("projects-note").textContent).toContain(
      "Cursor reports none, so it is not here",
    );
  });

  it("says so when the period holds no attributable usage at all", () => {
    render(<Projects snapshot={snapshot([])} />);

    expect(screen.getByTestId("projects-empty").textContent).toBe(
      "No OMP, Claude Code or Antigravity usage for this period, so there is nothing to break down by project",
    );
  });
});
