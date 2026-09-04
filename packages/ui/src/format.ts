/**
 * Display formatting shared by the hero and the by-model table.
 *
 * Unknown price is always the em dash, never `$0`: `$0.00` means the estimate
 * really is zero. Token counts are compact, as in the designs.
 */

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
