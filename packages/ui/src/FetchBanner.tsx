/**
 * The failed-fetch banner, and the one place its copy is written.
 *
 * A fetch that fails never blanks the screen: the previous snapshot stays, and
 * this says what broke plus offers Retry — the same fetch the header button
 * triggers, not a timer. Partial success is the common case, so the copy names
 * the source that failed and the one that still worked: `Cursor failed · OMP OK`.
 *
 * Cursor not installed / signed out / disabled is *degraded*, not failed: the
 * reader reports the pass clean, so nothing here ever fires for it.
 *
 * Props only, like the rest of this package. Hosts hold the per-source verdicts
 * of a pass, so they call `fetchErrorMessage` and store the line in
 * `DashboardSnapshot.fetch.error` — the one field the frozen contract has for
 * it — and the banner renders that string verbatim.
 */

import type { DashboardSnapshot } from "@prompt-burn/core";

/** Source labels in banner order, as the reader also writes them. */
const LABELS = ["OMP", "Cursor"] as const;

/** Shown when a host set `status: "error"` without a message of its own. */
const FALLBACK = "Fetch failed";

/**
 * One fetch pass, as both shells receive it. `omp` / `cursor` are absent when
 * the call itself threw and no source ever reported.
 */
export interface FetchPass {
  omp?: { ok: boolean };
  cursor?: { ok: boolean };
  /**
   * The reader's own text: ` · `-joined `OMP failed: …` / `Cursor failed: …`
   * lines, or a thrown message. Only a real failure is named there, which is
   * what keeps a degraded Cursor out of this copy.
   */
  error?: string;
}

/**
 * `Cursor failed · OMP OK — cursor.com said 503`.
 *
 * Which sources failed comes from the reader's text, because that is the only
 * signal that separates a failure from a degraded source; `OK` is claimed only
 * for a source that reported success. A pass that names neither — the call
 * threw before either source answered — is just `Fetch failed`.
 */
export function fetchErrorMessage(pass: FetchPass): string {
  const detail = pass.error?.trim() ?? "";
  const succeeded: Record<(typeof LABELS)[number], boolean | undefined> = {
    OMP: pass.omp?.ok,
    Cursor: pass.cursor?.ok,
  };

  const failed = LABELS.filter((label) => detail.includes(`${label} failed`));
  const headline =
    failed.length === 0
      ? FALLBACK
      : [
          ...failed.map((label) => `${label} failed`),
          ...LABELS.filter((label) => !failed.includes(label) && succeeded[label] === true).map(
            (label) => `${label} OK`,
          ),
        ].join(" · ");

  // The headline already names the sources; the detail keeps only the reasons.
  const reasons = detail
    .split(" · ")
    .map((line) => line.replace(/^(?:OMP|Cursor) failed: /, ""))
    .filter((line) => line !== "")
    .join(" · ");

  return reasons === "" ? headline : `${headline} — ${reasons}`;
}

export interface FetchErrorBannerProps {
  snapshot: DashboardSnapshot;
  /** Retry runs the host's fetch — the same one the header button triggers. */
  onRetry?: () => void;
}

/**
 * The banner, or nothing. A fetch in flight shows the spinner instead: hosts
 * set `status: "fetching"` while retrying, so the numbers stay put and the
 * banner steps aside rather than stacking on top of the attempt to clear it.
 */
export function FetchErrorBanner({ snapshot, onRetry }: FetchErrorBannerProps) {
  if (snapshot.fetch.status !== "error") return null;

  return (
    <div
      role="alert"
      data-testid="fetch-error"
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-card border border-error bg-surface px-4 py-3"
    >
      <p data-testid="fetch-error-message" className="text-small leading-small text-error">
        <span aria-hidden="true">⚠ </span>
        {snapshot.fetch.error ?? FALLBACK}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-control border border-error px-3 py-1.5 text-small font-medium text-error"
      >
        Retry
      </button>
    </div>
  );
}
