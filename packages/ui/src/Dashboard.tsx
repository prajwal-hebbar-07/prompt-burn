/**
 * The Dashboard route body: the hero score panel, then provider clocks, then
 * the by-model board.
 *
 * Combined estimate, then all four source subtotals — always all four, never
 * deduped, never re-derived here. Cursor answers for the period itself when it
 * can; when all it has is a whole billing cycle (`mixedPeriod`) its cost stays
 * on its own row, out of the hero number, and both the subtitle and that row
 * say so. OMP, Claude Code and Antigravity are timestamped, so they are never
 * out of scope that way. The cycle's own dates are the cycle banner's job, not
 * this card's.
 *
 * The Antigravity row is the standalone `agy` CLI's own priced turns, and it is
 * not the Antigravity card in the Usage limits panel below: that one is Google's
 * quota clock, unpriced and unfiltered. They carry different colours on purpose
 * — `source-antigravity` here, `provider-antigravity` there.
 *
 * One unpriced model used to blank the whole number: `estimatedCents` is null
 * when any included row has no rate, and the hero showed `—` even with dollars
 * of priced usage on screen. It now falls back to the sum of the rows that *do*
 * price, marked `≈` and counted ("2 models unpriced"), so an unknown rate costs
 * you precision, not the number.
 *
 * This package never touches a filesystem, a network, the collectors, the
 * database or the sidecar: hosts pass a `DashboardSnapshot` in and rendering is
 * all that happens here.
 */

import { CURSOR_CYCLE_LABEL, type DashboardSnapshot, type Source } from "@prompt-burn/core";
import { CycleFootnote } from "./CursorCycle.js";
import { UNKNOWN_COST, formatCents, tokenLine } from "./format.js";
import { ModelTable } from "./ModelTable.js";
import { periodLabel } from "./PeriodBar.js";
import { UsageLimits } from "./UsageLimits.js";

/** Product's exact sentence for a successful fetch with nothing in it. */
const NO_USAGE = "No OMP, Claude Code, Antigravity or Cursor usage for this period";

/** Before the first successful fetch there is nothing to be zero about. */
const NOT_FETCHED = "No usage data yet";
/** What the priced rows add up to, and how many rows had no rate at all. */
export interface PricedSubtotal {
  /** Sum of the rows with a known rate; `null` when not one row priced. */
  cents: number | null;
  unpriced: number;
}

/**
 * The sources whose events carry timestamps, so they always obey the selected
 * period and are always inside the hero number. Cursor is the odd one out: a
 * whole-cycle answer can sit outside the period entirely.
 */
const TIMESTAMPED: readonly Source[] = ["omp", "claude-code", "antigravity"];

/**
 * Adds up the rows that price, optionally for one source or a set of them.
 *
 * This is the fallback the hero falls back *to*, so it takes the same scope as
 * the hero: pass `TIMESTAMPED` while Cursor's cycle is out of the period.
 */
export function pricedSubtotal(
  rows: DashboardSnapshot["models"],
  source?: Source | readonly Source[],
): PricedSubtotal {
  const scope = typeof source === "string" ? [source] : source;
  let cents: number | null = null;
  let unpriced = 0;
  for (const row of rows) {
    if (scope !== undefined && !scope.includes(row.source)) continue;
    if (row.estimatedCents === null) unpriced += 1;
    else cents = (cents ?? 0) + row.estimatedCents;
  }
  return { cents, unpriced };
}

/**
 * A cost for display: the exact total, else the priced rows marked `≈`, else
 * the em dash. `$0` is never a stand-in for an unknown rate.
 */
function costText(exact: number | null, fallback: PricedSubtotal): string {
  if (exact !== null) return formatCents(exact);
  if (fallback.cents !== null) return `≈${formatCents(fallback.cents)}`;
  return UNKNOWN_COST;
}

/** The combined total: exact, approximate from priced rows, or the em dash. */
export function formatEstimatedTotal(snapshot: DashboardSnapshot): string {
  // Same scope as the number it stands in for: the timestamped sources alone
  // while Cursor's cycle is out of the period.
  return costText(
    snapshot.estimatedCents,
    pricedSubtotal(snapshot.models, snapshot.mixedPeriod ? TIMESTAMPED : undefined),
  );
}

/**
 * The body copy for an empty period, or `null` when there is data to show.
 *
 * Never fetched and fetched-but-empty are different states: only a successful
 * fetch can say the period really had no usage. A fetch in flight keeps
 * whatever the previous snapshot had — this only decides the empty body.
 */
export function emptyStateMessage(snapshot: DashboardSnapshot): string | null {
  const tokens = [
    snapshot.omp.tokens,
    snapshot.claudeCode.tokens,
    snapshot.antigravity.tokens,
    snapshot.cursor.tokens,
  ];
  const used =
    snapshot.models.length > 0 ||
    tokens.some((t) => t.input + t.output + (t.cacheRead ?? 0) + (t.cacheWrite ?? 0) > 0);
  if (used) return null;
  return snapshot.fetch.lastSuccessAt === null ? NOT_FETCHED : NO_USAGE;
}

/**
 * `Estimated total · Today` when Cursor answered for the period too, and
 * `Estimated total · OMP + Claude Code: Today · Cursor: cycle to date (not in
 * total)` when all Cursor had was its billing cycle. Locked in product.md and
 * spec.md — every mixed period names both scopes, and says which one the
 * number is. OMP, Claude Code and Antigravity share the first scope because
 * all three are timestamped and all three are in the number; Cursor is the
 * only source that can be stuck on a cycle.
 */
export function heroSubtitle(snapshot: DashboardSnapshot): string {
  const period = periodLabel(snapshot.period);
  if (!snapshot.mixedPeriod) return `Estimated total · ${period}`;
  const cycle = (snapshot.cursor.cycleLabel ?? CURSOR_CYCLE_LABEL).toLowerCase();
  // Only the sources actually on screen are named; a switched-off one has no
  // scope to declare.
  const scope = [
    snapshot.enabled.omp ? "OMP" : null,
    snapshot.enabled["claude-code"] ? "Claude Code" : null,
    snapshot.enabled.antigravity ? "Antigravity" : null,
  ]
    .filter((label) => label !== null)
    .join(" + ");
  if (scope === "") return `Estimated total · Cursor: ${cycle} (not in total)`;
  return `Estimated total · ${scope}: ${period} · Cursor: ${cycle} (not in total)`;
}

/** Total tokens for a source, used only to split the meter when nothing prices. */
function tokenWeight(tokens: DashboardSnapshot["omp"]["tokens"]): number {
  return tokens.input + tokens.output + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0);
}

/** One meter's worth of segments, in the order they are drawn. */
export interface SourceShares {
  omp: number;
  claudeCode: number;
  antigravity: number;
  cursor: number;
}

/**
 * How wide each segment of the split meter is. Spend decides it; with no priced
 * row anywhere the meter falls back to token volume so the bar still says which
 * source did the work.
 *
 * A Cursor cycle that is out of the period is out of the meter too — it is not
 * part of the number the meter divides. Claude Code and Antigravity are
 * timestamped, so they are never excluded that way.
 */
export function sourceShares(
  snapshot: DashboardSnapshot,
  omp: number | null,
  claudeCode: number | null,
  antigravity: number | null,
  cursor: number | null,
): SourceShares {
  const split = (parts: SourceShares): SourceShares => {
    const total = parts.omp + parts.claudeCode + parts.antigravity + parts.cursor;
    if (total <= 0) return { omp: 0, claudeCode: 0, antigravity: 0, cursor: 0 };
    return {
      omp: (parts.omp / total) * 100,
      claudeCode: (parts.claudeCode / total) * 100,
      antigravity: (parts.antigravity / total) * 100,
      cursor: (parts.cursor / total) * 100,
    };
  };
  const spend = split({
    omp: Math.max(omp ?? 0, 0),
    claudeCode: Math.max(claudeCode ?? 0, 0),
    antigravity: Math.max(antigravity ?? 0, 0),
    cursor: snapshot.mixedPeriod ? 0 : Math.max(cursor ?? 0, 0),
  });
  if (spend.omp + spend.claudeCode + spend.antigravity + spend.cursor > 0) return spend;
  return split({
    omp: tokenWeight(snapshot.omp.tokens),
    claudeCode: tokenWeight(snapshot.claudeCode.tokens),
    antigravity: tokenWeight(snapshot.antigravity.tokens),
    cursor: snapshot.mixedPeriod ? 0 : tokenWeight(snapshot.cursor.tokens),
  });
}

interface SubtotalRowProps {
  testId: string;
  label: string;
  /** Token class for the source dot; the label always travels with it. */
  dotClass: string;
  text: string;
}

/** One source line: colored dot, text label, amount. Never hidden. */
function SubtotalRow({ testId, label, dotClass, text }: SubtotalRowProps) {
  return (
    <div
      data-testid={testId}
      className="flex items-center justify-between rounded-control px-2 py-1.5 transition-colors hover:bg-surface-subtle"
    >
      <span className="flex items-center gap-2 text-body">
        <span aria-hidden="true" className={`size-2.5 rounded-full ${dotClass}`} />
        {label}
      </span>
      <span className="font-mono text-body font-medium tabular-nums">{text}</span>
    </div>
  );
}

export interface DashboardProps {
  snapshot: DashboardSnapshot;
}

export function Dashboard({ snapshot }: DashboardProps) {
  // The cycle label is set only while Cursor's rows really are cycle-wide, and
  // a cycle-wide row against a narrower period is not in the hero number.
  const cursorLabel = snapshot.cursor.cycleLabel
    ? `Cursor (${snapshot.cursor.cycleLabel.toLowerCase()}${snapshot.mixedPeriod ? " · not in total" : ""})`
    : "Cursor";
  const empty = emptyStateMessage(snapshot);

  // Same scope as the hero: an unpriced Cursor row cannot make a number it is
  // not part of a floor.
  const combined = pricedSubtotal(snapshot.models, snapshot.mixedPeriod ? TIMESTAMPED : undefined);
  const ompPriced = pricedSubtotal(snapshot.models, "omp");
  const claudePriced = pricedSubtotal(snapshot.models, "claude-code");
  const antigravityPriced = pricedSubtotal(snapshot.models, "antigravity");
  const cursorPriced = pricedSubtotal(snapshot.models, "cursor");
  const shares = sourceShares(
    snapshot,
    snapshot.omp.estimatedCents ?? ompPriced.cents,
    snapshot.claudeCode.estimatedCents ?? claudePriced.cents,
    snapshot.antigravity.estimatedCents ?? antigravityPriced.cents,
    snapshot.cursor.estimatedCents ?? cursorPriced.cents,
  );
  const approximate = snapshot.estimatedCents === null && combined.cents !== null;

  return (
    <div className="flex flex-col gap-6">
      <CycleFootnote snapshot={snapshot} />
      <section
        aria-labelledby="hero-subtitle"
        className="animate-rise relative overflow-hidden rounded-card border border-border bg-surface p-6"
      >
        {/* Pure decoration: an amber bloom behind the score. */}
        <span
          aria-hidden="true"
          // The keyframe animates opacity, so the tint lives in the colour.
          className="animate-glow pointer-events-none absolute -top-24 -right-16 size-72 rounded-full bg-brand/20 blur-3xl"
        />

        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <p
              id="hero-subtitle"
              data-testid="hero-subtitle"
              className="text-small leading-small font-medium tracking-wide text-foreground-muted uppercase"
            >
              {heroSubtitle(snapshot)}
            </p>
            <p
              data-testid="estimated-total"
              className="mt-2 text-hero leading-hero font-semibold tracking-tight tabular-nums"
            >
              {formatEstimatedTotal(snapshot)}
            </p>
          </div>
          {combined.unpriced > 0 ? (
            <p
              data-testid="unpriced-note"
              className="rounded-full border border-warning bg-brand-subtle px-3 py-1 text-small leading-small font-medium text-warning"
            >
              {combined.unpriced} model{combined.unpriced === 1 ? "" : "s"} unpriced
              {approximate ? " · total is a floor" : ""}
            </p>
          ) : null}
        </div>

        {/* Who burned it: every switched-on source, by spend, tokens as the
            fallback. A source that is off is not a zero segment here — it is
            simply not on this screen. */}
        <div
          aria-hidden="true"
          data-testid="source-meter"
          className="relative mt-5 flex h-2.5 gap-1 overflow-hidden rounded-full bg-surface-subtle"
        >
          {snapshot.enabled.omp ? (
            <span
              className="animate-bar h-full origin-left rounded-full bg-source-omp"
              style={{ width: `${shares.omp}%` }}
            />
          ) : null}
          {snapshot.enabled["claude-code"] ? (
            <span
              className="animate-bar h-full origin-left rounded-full bg-provider-claude"
              style={{ width: `${shares.claudeCode}%` }}
            />
          ) : null}
          {snapshot.enabled.antigravity ? (
            <span
              className="animate-bar h-full origin-left rounded-full bg-source-antigravity"
              style={{ width: `${shares.antigravity}%` }}
            />
          ) : null}
          {snapshot.enabled.cursor ? (
            <span
              className="animate-bar h-full origin-left rounded-full bg-source-cursor"
              style={{ width: `${shares.cursor}%` }}
            />
          ) : null}
        </div>

        <div className="relative mt-4 border-t border-border pt-2">
          {snapshot.enabled.omp ? (
            <SubtotalRow
              testId="omp-subtotal"
              label="OMP"
              dotClass="bg-source-omp"
              text={costText(snapshot.omp.estimatedCents, ompPriced)}
            />
          ) : null}
          {snapshot.enabled["claude-code"] ? (
            <SubtotalRow
              testId="claude-code-subtotal"
              label="Claude Code"
              dotClass="bg-provider-claude"
              text={costText(snapshot.claudeCode.estimatedCents, claudePriced)}
            />
          ) : null}
          {snapshot.enabled.antigravity ? (
            // The `agy` CLI's own turns. The Usage-limits card of the same name
            // is Google's quota clock, not this cost — hence the different
            // colour and the caption in that panel.
            <SubtotalRow
              testId="antigravity-subtotal"
              label="Antigravity (agy CLI)"
              dotClass="bg-source-antigravity"
              text={costText(snapshot.antigravity.estimatedCents, antigravityPriced)}
            />
          ) : null}
          {snapshot.enabled.cursor ? (
            <SubtotalRow
              testId="cursor-subtotal"
              label={cursorLabel}
              dotClass="bg-source-cursor"
              text={costText(snapshot.cursor.estimatedCents, cursorPriced)}
            />
          ) : null}
        </div>

        <p
          data-testid="token-breakdown"
          className="relative mt-3 font-mono text-small leading-small text-foreground-muted"
        >
          {tokenLine(
            snapshot.omp.tokens,
            snapshot.claudeCode.tokens,
            snapshot.antigravity.tokens,
            snapshot.cursor.tokens,
          )}
        </p>
      </section>
      {/* Subscription windows sit under the score and above the by-model board.
          They are still the providers' clocks, not this screen's calendar. */}
      <UsageLimits snapshot={snapshot} />
      {empty === null ? (
        <ModelTable rows={snapshot.models} />
      ) : (
        <p data-testid="empty-state" className="text-body text-foreground-secondary">
          {empty}
        </p>
      )}
    </div>
  );
}
