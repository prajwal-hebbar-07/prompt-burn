/**
 * The Projects route: every OMP working directory that burned tokens in the
 * selected period, biggest spender first, each with the models it used.
 *
 * A project is the `cwd` off an OMP session header — the directory the agent
 * ran in. Cursor reports no directory at all, so it is absent here by
 * construction; the callout says that out loud rather than letting the missing
 * violet read as a bug.
 *
 * Rows come pre-ranked from core, so this file only lays them out. The model
 * board inside each project is the same `ModelTable` the Dashboard uses: same
 * ranking, same bars, same em dash for an unpriced model.
 */

import type { DashboardSnapshot, ProjectUsage } from "@prompt-burn/core";
import { formatCost, tokenLine } from "./format.js";
import { ModelTable } from "./ModelTable.js";

/** Usage from a transcript that carried no `cwd` — real work, no owner. */
export const UNATTRIBUTED = "No project";

/** Nothing has been attributed yet: no OMP events, or none in this period. */
const NO_PROJECTS = "No OMP usage for this period, so there is nothing to break down by project";

/** Cursor cannot appear on this screen, and the screen has to admit it. */
const CURSOR_NOTE = "Projects are OMP working directories · Cursor reports none, so it is not here";

/**
 * The basename of a project path, widened to `parent/name` only where two
 * projects would otherwise read identically (`~/work/api` beside
 * `~/personal/api`).
 *
 * ponytail: O(n²) over the project list. It is one screen of directories; make
 * it a prepared map if someone turns up with thousands.
 */
export function projectLabel(path: string | null, all: ReadonlyArray<string | null> = []): string {
  if (path === null) return UNATTRIBUTED;
  const parts = path.split("/").filter((part) => part !== "");
  const name = parts.at(-1) ?? path;
  const collides = all.some(
    (other) =>
      other !== null &&
      other !== path &&
      other.split("/").filter((part) => part !== "").at(-1) === name,
  );
  return collides && parts.length > 1 ? `${parts.at(-2)}/${name}` : name;
}

interface ProjectCardProps {
  usage: ProjectUsage;
  /** Every project on screen, so the label can disambiguate against them. */
  all: ReadonlyArray<string | null>;
}

function ProjectCard({ usage, all }: ProjectCardProps) {
  const models = usage.models.length;

  return (
    <section
      data-testid={`project-${usage.project ?? "unattributed"}`}
      className="animate-rise rounded-card border border-border bg-surface p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-body font-semibold tracking-tight">
            {projectLabel(usage.project, all)}
          </h2>
          {/* The full path, because two checkouts can share a basename. */}
          <p className="mt-0.5 font-mono text-small leading-small text-foreground-muted">
            {usage.project ?? "Transcript carried no working directory"}
          </p>
        </div>
        <p
          data-testid="project-cost"
          className="font-mono text-body font-semibold tabular-nums text-brand"
        >
          {formatCost(usage.estimatedCents)}
        </p>
      </div>
      <p className="mt-2 font-mono text-small leading-small text-foreground-muted">
        {models} model{models === 1 ? "" : "s"} · {tokenLine(usage.tokens)}
      </p>
      <div className="mt-4">
        <ModelTable rows={usage.models} />
      </div>
    </section>
  );
}

export interface ProjectsProps {
  snapshot: DashboardSnapshot;
}

export function Projects({ snapshot }: ProjectsProps) {
  const all = snapshot.projects.map((usage) => usage.project);

  return (
    <div className="flex flex-col gap-6">
      <p
        data-testid="projects-note"
        className="rounded-card bg-source-cursor-subtle px-4 py-3 text-small leading-small text-source-cursor"
      >
        {CURSOR_NOTE}
      </p>
      {snapshot.projects.length === 0 ? (
        <p data-testid="projects-empty" className="text-body text-foreground-secondary">
          {NO_PROJECTS}
        </p>
      ) : (
        snapshot.projects.map((usage) => (
          <ProjectCard key={usage.project ?? ""} usage={usage} all={all} />
        ))
      )}
    </div>
  );
}
