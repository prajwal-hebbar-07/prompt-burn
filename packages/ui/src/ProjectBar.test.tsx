/**
 * The project picker. Two things can go wrong and both are silent: the select
 * emitting the label instead of the path the reader filters on, and two
 * directories that share a basename becoming the same-looking option.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectBar, projectLabel } from "./index.js";

afterEach(cleanup);

const PROJECTS = ["/Users/me/work/api", "/Users/me/personal/api", "/Users/me/prompt-burn"];

const select = () => screen.getByTestId("project-select") as HTMLSelectElement;

describe("projectLabel", () => {
  it("shows the basename, widened only where two projects collide", () => {
    expect(projectLabel("/Users/me/prompt-burn", PROJECTS)).toBe("prompt-burn");
    expect(projectLabel("/Users/me/work/api", PROJECTS)).toBe("work/api");
    expect(projectLabel("/Users/me/personal/api", PROJECTS)).toBe("personal/api");
  });
});

describe("ProjectBar", () => {
  it("emits the full path, and null for All projects", async () => {
    const onProjectChange = vi.fn<(project: string | null) => void>();
    const user = userEvent.setup();
    render(<ProjectBar projects={PROJECTS} project={null} onProjectChange={onProjectChange} />);

    // The label is a basename; what the reader filters on is the path.
    await user.selectOptions(select(), "/Users/me/work/api");
    await user.selectOptions(select(), "");

    expect(onProjectChange.mock.calls.map(([project]) => project)).toEqual([
      "/Users/me/work/api",
      null,
    ]);
  });

  it("renders nothing while there is no choice to make", () => {
    render(<ProjectBar projects={["/Users/me/prompt-burn"]} project={null} />);

    expect(screen.queryByTestId("project-select")).toBeNull();
  });

  it("keeps a selection whose rows left the period, so it can be cleared", () => {
    render(<ProjectBar projects={[]} project="/Users/me/work/api" />);

    expect(select().value).toBe("/Users/me/work/api");
  });
});
