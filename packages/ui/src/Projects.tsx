/**
 * The Projects route: every OMP, Claude Code or Antigravity working directory
 * that burned tokens in the selected period, biggest spender first, each with
 * the models it used.
 *
 * Designed for visual clarity:
 * - An SVG Donut / Ring chart at the top shows macro spend distribution across
 *   projects at a single glance, with the total in the center.
 * - Each project is rendered as a Gantt-style horizontal model lane, where the
 *   segmented track visually shows which models were used and in what proportion.
 * - Clean model chips below each lane detail the tokens and cost, replacing
 *   intimidating multi-column spreadsheet matrices.
 *
 * Cursor reports no working directory at all — a cycle-to-date aggregate
 * belongs to no directory — so it is absent here by construction; the callout
 * states that out loud. The `agy` CLI does record one (its conversation summary
 * carries the workspace path), so Antigravity rows are attributed like OMP's
 * and Claude Code's, each chip carrying its source pill.
 */

import type { DashboardSnapshot, ProjectUsage } from "@prompt-burn/core";
import { formatCost, formatTokens } from "./format.js";
import { SOURCE_PILLS } from "./ModelTable.js";

/** Usage from a transcript that carried no `cwd` — real work, no owner. */
export const UNATTRIBUTED = "No project";

/** Nothing attributed yet: no timestamped events, or none in this period. */
const NO_PROJECTS =
  "No OMP, Claude Code or Antigravity usage for this period, so there is nothing to break down by project";

/** Cursor cannot appear on this screen, and the screen has to admit it. */
const CURSOR_NOTE =
  "Projects are OMP, Claude Code and Antigravity working directories · Cursor reports none, so it is not here";

/** Color sequence for charts and indicators. */
export const CHART_PALETTE = [
  { hex: "#2dd4bf", bg: "bg-source-omp", border: "border-source-omp" },
  { hex: "#f59e0b", bg: "bg-brand", border: "border-brand" },
  { hex: "#7aa2f7", bg: "bg-provider-antigravity", border: "border-provider-antigravity" },
  { hex: "#e7a88a", bg: "bg-provider-claude", border: "border-provider-claude" },
  { hex: "#a78bfa", bg: "bg-source-cursor", border: "border-source-cursor" },
  { hex: "#2dd4e8", bg: "bg-provider-ollama", border: "border-provider-ollama" },
];

function tokenWeight(tokens: {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}): number {
  return tokens.input + tokens.output + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0);
}

/**
 * The basename of a project path, widened to `parent/name` only where two
 * projects would otherwise read identically (`~/work/api` beside
 * `~/personal/api`).
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

interface OverviewProps {
  projects: readonly ProjectUsage[];
  allPaths: ReadonlyArray<string | null>;
  totalSpend: number | null;
  overallTokens: number;
}

/**
 * An SVG Donut / Ring chart paired with a clean legend.
 * Radius = 50, Circumference = 2 * PI * 50 ≈ 314.159.
 */
function ProjectsRingOverview({
  projects,
  allPaths,
  totalSpend,
  overallTokens,
}: OverviewProps) {
  if (projects.length <= 1) return null;

  const radius = 50;
  const circumference = 2 * Math.PI * radius;

  // Calculate slice fractions based on spend (or tokens if unpriced)
  let accumulatedFraction = 0;
  const slices = projects.map((p, idx) => {
    const fraction =
      totalSpend !== null && totalSpend > 0 && p.estimatedCents !== null
        ? p.estimatedCents / totalSpend
        : overallTokens > 0
          ? tokenWeight(p.tokens) / overallTokens
          : 0;

    const strokeDasharray = `${(fraction * circumference).toFixed(2)} ${circumference.toFixed(2)}`;
    const strokeDashoffset = (-accumulatedFraction * circumference).toFixed(2);
    accumulatedFraction += fraction;
    const palette = CHART_PALETTE[idx % CHART_PALETTE.length]!;

    return {
      project: p.project,
      fraction,
      percent: (fraction * 100).toFixed(0),
      strokeDasharray,
      strokeDashoffset,
      palette,
      cents: p.estimatedCents,
      tokens: tokenWeight(p.tokens),
    };
  });

  return (
    <section
      data-testid="projects-overview"
      className="animate-rise rounded-card border border-border bg-surface p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4">
        <div>
          <p className="text-small leading-small font-medium tracking-wide text-foreground-muted uppercase">
            Project Overview
          </p>
          <h2 className="mt-0.5 text-title leading-title font-semibold tracking-tight tabular-nums text-foreground">
            {formatCost(totalSpend)} · {projects.length} projects
          </h2>
        </div>
        <span className="font-mono text-small text-foreground-muted">
          {formatTokens(overallTokens)} total tokens
        </span>
      </div>

      <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:items-center sm:justify-around">
        {/* SVG Donut / Ring Chart */}
        <div className="relative size-44 shrink-0">
          <svg
            viewBox="0 0 140 140"
            className="size-full -rotate-90"
            role="img"
            aria-label="Project spend distribution ring"
          >
            {/* Background track circle */}
            <circle
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke="var(--color-surface-subtle)"
              strokeWidth="16"
            />
            {/* Colored arc segments */}
            {slices.map((slice) => (
              <circle
                key={slice.project ?? "unattributed"}
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                stroke={slice.palette.hex}
                strokeWidth="16"
                strokeDasharray={slice.strokeDasharray}
                strokeDashoffset={slice.strokeDashoffset}
                className="transition-all duration-300"
              />
            ))}
          </svg>

          {/* Center cost callout */}
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="font-mono text-small font-bold tabular-nums text-foreground">
              {formatCost(totalSpend)}
            </span>
            <span className="text-table text-foreground-muted">Total burn</span>
          </div>
        </div>

        {/* Legend listing all projects with colors, spend, and share */}
        <div className="flex flex-1 flex-col gap-2.5 sm:max-w-md">
          {slices.map((slice) => (
            <div
              key={slice.project ?? "unattributed"}
              className="flex items-center justify-between gap-3 rounded-control bg-surface-subtle/40 px-3 py-2 text-small"
            >
              <div className="flex items-center gap-2.5 overflow-hidden">
                <span className={`size-2.5 shrink-0 rounded-full ${slice.palette.bg}`} aria-hidden="true" />
                <span className="truncate font-medium text-foreground">
                  {projectLabel(slice.project, allPaths)}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3 font-mono">
                <span className="font-semibold text-foreground">{formatCost(slice.cents)}</span>
                <span className="w-10 text-right text-foreground-muted">{slice.percent}%</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

interface ProjectCardProps {
  usage: ProjectUsage;
  all: ReadonlyArray<string | null>;
}

/**
 * A project card rendered as a Gantt-style horizontal model track.
 * The bar visually shows which models were used and in what proportion,
 * followed by clean model chips with exact token and cost details.
 */
function ProjectCard({ usage, all }: ProjectCardProps) {
  const modelsCount = usage.models.length;
  const projectTokens = tokenWeight(usage.tokens);

  // Calculate model breakdown for the Gantt bar
  const modelSegments = usage.models.map((m, idx) => {
    const tokens = tokenWeight(m.tokens);
    const tokenShare = projectTokens > 0 ? (tokens / projectTokens) * 100 : 0;
    const share =
      usage.estimatedCents !== null && usage.estimatedCents > 0 && m.estimatedCents !== null
        ? (m.estimatedCents / usage.estimatedCents) * 100
        : tokenShare;
    const palette = CHART_PALETTE[idx % CHART_PALETTE.length]!;

    return {
      model: m.model,
      source: m.source,
      tokens,
      share,
      cents: m.estimatedCents,
      palette,
      inTokens: m.tokens.input,
      outTokens: m.tokens.output,
      cacheTokens: (m.tokens.cacheRead ?? 0) + (m.tokens.cacheWrite ?? 0),
    };
  });

  return (
    <section
      data-testid={`project-${usage.project ?? "unattributed"}`}
      className="animate-rise rounded-card border border-border bg-surface p-6"
    >
      {/* Project Card Header */}
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-body font-semibold tracking-tight text-foreground">
            {projectLabel(usage.project, all)}
          </h2>
          <p className="mt-0.5 font-mono text-small leading-small text-foreground-muted">
            {usage.project ?? "Transcript carried no working directory"}
          </p>
        </div>
        <div className="text-right">
          <p
            data-testid="project-cost"
            className="font-mono text-title font-semibold tabular-nums text-brand"
          >
            {formatCost(usage.estimatedCents)}
          </p>
          <p className="mt-0.5 font-mono text-small leading-small text-foreground-secondary tabular-nums">
            {formatTokens(projectTokens)} tokens · {modelsCount} model{modelsCount === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      {/* Gantt-style Horizontal Model Lane */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between text-table font-medium text-foreground-muted uppercase tracking-wider">
          <span>Model Distribution Lane</span>
          <span>{modelsCount} model{modelsCount === 1 ? "" : "s"} used</span>
        </div>

        {/* The segmented horizontal bar track */}
        <div
          role="img"
          aria-label={`Model usage breakdown for ${projectLabel(usage.project, all)}`}
          className="relative flex h-7 w-full overflow-hidden rounded-control bg-surface-subtle p-0.5"
        >
          {modelSegments.map((seg) => (
            <div
              key={`${seg.source}:${seg.model}`}
              title={`${SOURCE_PILLS[seg.source].label} · ${seg.model}: ${seg.share.toFixed(1)}% (${formatCost(seg.cents)})`}
              className={`relative flex h-full items-center justify-center overflow-hidden rounded-sm px-1.5 text-table font-semibold text-white transition-all ${seg.palette.bg}`}
              style={{ width: `${Math.max(seg.share, 1.5)}%` }}
            >
              {seg.share >= 14 ? (
                <span className="truncate drop-shadow-sm font-mono text-small">
                  {seg.model} ({seg.share.toFixed(0)}%)
                </span>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {/* Model Detail Chips: readable, spacious breakdown cards */}
      <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {modelSegments.map((seg) => (
          <div
            key={`${seg.source}:${seg.model}`}
            data-testid={`model-row-${seg.source}-${seg.model}`}
            className="flex flex-col justify-between gap-1.5 rounded-control border border-border/70 bg-surface-subtle/30 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 overflow-hidden">
                <span className={`size-2 shrink-0 rounded-full ${seg.palette.bg}`} aria-hidden="true" />
                <span className="truncate font-mono text-small font-semibold text-foreground">
                  {seg.model}
                </span>
                {/* Which tool spent it: colour and wording from the shared
                    source map, so Antigravity reads the same here as in the
                    by-model board. */}
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-table font-medium ${SOURCE_PILLS[seg.source].className}`}
                >
                  {SOURCE_PILLS[seg.source].label}
                </span>
              </div>
              <span className="font-mono text-small font-semibold tabular-nums text-brand">
                {formatCost(seg.cents)}
              </span>
            </div>

            <div className="flex items-center justify-between font-mono text-table text-foreground-muted">
              <span>
                {formatTokens(seg.tokens)} tokens
                {seg.tokens > 0 ? (
                  <span className="ml-1 text-foreground-secondary">
                    ({formatTokens(seg.inTokens)} in · {formatTokens(seg.outTokens)} out
                    {seg.cacheTokens > 0 ? ` · ${formatTokens(seg.cacheTokens)} cache` : ""})
                  </span>
                ) : null}
              </span>
              <span className="font-medium text-foreground-secondary">
                {seg.share.toFixed(0)}%
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export interface ProjectsProps {
  snapshot: DashboardSnapshot;
}

export function Projects({ snapshot }: ProjectsProps) {
  const allPaths = snapshot.projects.map((usage) => usage.project);
  const totalSpend = snapshot.projects.reduce<number | null>((acc, p) => {
    if (acc === null || p.estimatedCents === null) return null;
    return acc + p.estimatedCents;
  }, 0);
  const overallTokens = snapshot.projects.reduce(
    (acc, p) => acc + tokenWeight(p.tokens),
    0,
  );

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
        <>
          <ProjectsRingOverview
            projects={snapshot.projects}
            allPaths={allPaths}
            totalSpend={totalSpend}
            overallTokens={overallTokens}
          />
          {snapshot.projects.map((usage) => (
            <ProjectCard key={usage.project ?? ""} usage={usage} all={allPaths} />
          ))}
        </>
      )}
    </div>
  );
}
