/**
 * Display formatting shared by the hero, the by-model table and the Cursor
 * cycle banner.
 *
 * Unknown price is always the em dash, never `$0`: `$0.00` means the estimate
 * really is zero. Token counts are compact, as in the designs. Date spans are
 * formatted in the device timezone; a window we do not have is `null`, never an
 * invented range.
 */

import type { TokenCounts } from "@prompt-burn/core";

/** Em dash for every unknown cost — never `$0`. */
export const UNKNOWN_COST = "—";

/** Formats fractional cents as USD with 2 decimals: 1234.5 -> "$12.35". */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/** A cost cell: the amount, or the em dash when the price is unknown. */
export function formatCost(cents: number | null): string {
  return cents === null ? UNKNOWN_COST : formatCents(cents);
}

/** Compact token counts, as in the designs: `1.2M`, `340K`, `89`. */
export function formatTokens(count: number): string {
  const scale = (divisor: number, suffix: string) =>
    `${(count / divisor).toFixed(1).replace(/\.0$/, "")}${suffix}`;
  if (count >= 1_000_000) return scale(1_000_000, "M");
  if (count >= 1_000) return scale(1_000, "K");
  return String(count);
}

/** `Tokens: 1.2M in · 340K out · 89K cache` — cache is read plus write. */
export function tokenLine(...parts: TokenCounts[]): string {
  const sum = (pick: (tokens: TokenCounts) => number) =>
    parts.reduce((total, tokens) => total + pick(tokens), 0);
  const input = sum((t) => t.input);
  const output = sum((t) => t.output);
  const cache = sum((t) => (t.cacheRead ?? 0) + (t.cacheWrite ?? 0));
  return `Tokens: ${formatTokens(input)} in · ${formatTokens(output)} out · ${formatTokens(cache)} cache`;
}

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const DAY_YEAR = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/** `Aug 1 – Aug 15, 2026`, or a single `Aug 1, 2026` for one day. */
export function formatDateSpan(from: Date, to: Date): string {
  if (from.getTime() === to.getTime()) return DAY_YEAR.format(from);
  if (from.getFullYear() === to.getFullYear()) {
    return `${DAY.format(from)} – ${DAY_YEAR.format(to)}`;
  }
  return `${DAY_YEAR.format(from)} – ${DAY_YEAR.format(to)}`;
}

/**
 * The Cursor billing cycle as text, in the device timezone. The dates arrive as
 * ISO UTC instants from `/api/usage-summary` and are not month-aligned.
 *
 * `null` when the collector has no window yet (empty strings, unparsable
 * values): the UI omits the range rather than inventing one.
 */
export function formatCycleWindow(
  start: string | undefined,
  end: string | undefined,
): string | null {
  if (!start || !end) return null;
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return formatDateSpan(from, to);
}
