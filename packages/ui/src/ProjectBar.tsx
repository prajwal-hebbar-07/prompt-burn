/**
 * The project picker: All projects, or one OMP working directory.
 *
 * A native `<select>` on purpose — the option list is as long as the number of
 * directories OMP has run in, which is unbounded and unsorted by importance, so
 * a segmented control like the period bar would wrap off the screen. The
 * editor's own widget also keeps keyboard and screen-reader behaviour for free.
 *
 * Only OMP events carry a project (`cwd` off the session header), so picking one
 * drops Cursor's cycle rather than attributing a cycle-to-date total to a
 * directory — the Dashboard says as much on the Cursor line.
 *
 * Hidden entirely while there is nothing to choose between: a screen with one
 * project has no filter to offer.
 */

/**
 * The basename of a project path, widened to `parent/name` only where two
 * projects would otherwise read identically (`~/work/api` beside
 * `~/personal/api`).
 *
 * ponytail: O(n²) over the option list. It is one dropdown of directories; make
 * it a prepared map if someone turns up with thousands.
 */
export function projectLabel(path: string, all: readonly string[] = []): string {
  const parts = path.split("/").filter((part) => part !== "");
  const name = parts.at(-1) ?? path;
  const collides = all.some(
    (other) => other !== path && other.split("/").filter((part) => part !== "").at(-1) === name,
  );
  return collides && parts.length > 1 ? `${parts.at(-2)}/${name}` : name;
}

/** The unfiltered option's label, and its `<option>` value. */
export const ALL_PROJECTS = "All projects";

export interface ProjectBarProps {
  /** Every project in the current period, from `snapshot.projects`. */
  projects: readonly string[];
  /** The selected project, or `null` for all of them. */
  project: string | null;
  onProjectChange?: (project: string | null) => void;
}

export function ProjectBar({ projects, project, onProjectChange }: ProjectBarProps) {
  // One project is not a choice. A stale selection still renders, so it can
  // always be cleared even after its rows leave the period.
  if (projects.length < 2 && project === null) return null;

  // A selection whose rows fell out of the period keeps its own option, or the
  // select would silently jump to All projects while the rows stay filtered.
  const options =
    project !== null && !projects.includes(project) ? [...projects, project] : projects;

  return (
    <label className="flex items-center gap-2 text-small text-foreground-secondary">
      Project
      <select
        data-testid="project-select"
        value={project ?? ""}
        onChange={(event) => onProjectChange?.(event.target.value === "" ? null : event.target.value)}
        className="rounded-control border border-border bg-surface px-2 py-1.5 text-small font-medium text-foreground"
      >
        <option value="">{ALL_PROJECTS}</option>
        {options.map((path) => (
          <option key={path} value={path} title={path}>
            {projectLabel(path, options)}
          </option>
        ))}
      </select>
    </label>
  );
}
