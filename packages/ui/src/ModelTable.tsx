/**
 * The by-model board: one row per `(source, model)`, ranked by spend.
 *
 * The same model on OMP and Cursor is deliberately two rows — sources are
 * never merged and never deduped, here or in the totals. Rows are ordered by
 * estimated cost, biggest first, with unpriceable rows last by token volume:
 * the point of this table is which model is burning the money.
 *
 * An unpriceable model stays visible with `—` in the cost cell: Cursor's
 * `default` (Auto) row is the guaranteed case. Its bar falls back to token
 * volume so the row still reads as work done. Pricing it is a Settings job,
 * not this table's.
 */

import type { DashboardSnapshot, Source, TokenCounts } from "@prompt-burn/core";
import { UNKNOWN_COST, formatCost, formatTokens } from "./format.js";

/** Source identity is a color *and* a label, never a color alone. */
const PILLS: Record<Source, { label: string; className: string; bar: string }> = {
  omp: {
    label: "OMP",
    className: "bg-source-omp-subtle text-source-omp ring-1 ring-source-omp/30",
    bar: "bg-source-omp",
  },
  cursor: {
    label: "Cursor",
    className: "bg-source-cursor-subtle text-source-cursor ring-1 ring-source-cursor/30",
    bar: "bg-source-cursor",
  },
};

/** Medals for the top three, a plain chip for everyone else. */
const RANKS = [
  "border-rank-gold bg-rank-gold/15 text-rank-gold",
  "border-rank-silver bg-rank-silver/15 text-rank-silver",
  "border-rank-bronze bg-rank-bronze/15 text-rank-bronze",
];

const COLUMNS = ["#", "Model", "Source", "In", "Out", "Cache R", "Cache W", "Est. cost"];

/** Cursor omits cache keys when zero; a missing count is not an unknown price. */
function tokenCell(count: number | undefined): string {
  return count === undefined ? UNKNOWN_COST : formatTokens(count);
}

function numericCells(tokens: TokenCounts): string[] {
  return [
    formatTokens(tokens.input),
    formatTokens(tokens.output),
    tokenCell(tokens.cacheRead),
    tokenCell(tokens.cacheWrite),
  ];
}

/** Every token a row moved — the ranking tie-break, and the unpriced bar. */
function tokenWeight(tokens: TokenCounts): number {
  return tokens.input + tokens.output + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0);
}

/** Spend first, biggest first; unpriced rows sink below every priced one. */
export function rankRows(rows: DashboardSnapshot["models"]): DashboardSnapshot["models"] {
  return [...rows].sort((a, b) => {
    const spend = (b.estimatedCents ?? -1) - (a.estimatedCents ?? -1);
    return spend !== 0 ? spend : tokenWeight(b.tokens) - tokenWeight(a.tokens);
  });
}

export interface ModelTableProps {
  rows: DashboardSnapshot["models"];
}

export function ModelTable({ rows }: ModelTableProps) {
  const ranked = rankRows(rows);
  const topCost = Math.max(0, ...ranked.map((row) => row.estimatedCents ?? 0));
  const topTokens = Math.max(0, ...ranked.map((row) => tokenWeight(row.tokens)));

  /** Bar width: share of the biggest spender, or of the biggest token pile. */
  const share = (row: DashboardSnapshot["models"][number]): number => {
    if (row.estimatedCents !== null && topCost > 0) return (row.estimatedCents / topCost) * 100;
    if (topTokens > 0) return (tokenWeight(row.tokens) / topTokens) * 100;
    return 0;
  };

  return (
    <table data-testid="model-table" className="w-full border-collapse text-body">
      <caption className="sr-only">Estimated cost by source and model, highest spend first</caption>
      <thead>
        <tr className="border-b border-border">
          {COLUMNS.map((column, index) => (
            <th
              key={column}
              scope="col"
              className={`py-2 text-table leading-table font-medium tracking-wide text-foreground-muted uppercase ${
                index < 3 ? "text-left" : "text-right"
              }`}
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {ranked.map(({ source, model, tokens, estimatedCents }, index) => (
          <tr
            key={`${source}:${model}`}
            data-testid={`model-row-${source}-${model}`}
            style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
            className="animate-rise border-b border-border transition-colors last:border-0 hover:bg-surface-subtle"
          >
            <td className="w-10 py-3">
              <span
                className={`flex size-6 items-center justify-center rounded-full border text-table font-semibold tabular-nums ${
                  RANKS[index] ?? "border-border text-foreground-muted"
                }`}
              >
                {index + 1}
              </span>
            </td>
            <td className="py-3 pr-4">
              <span className="font-mono text-small">{model}</span>
              {/* Length is the leaderboard: share of the biggest spender. */}
              <span
                aria-hidden="true"
                className="mt-1.5 block h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-surface-subtle"
              >
                <span
                  className={`animate-bar block h-full origin-left rounded-full ${PILLS[source].bar} ${
                    estimatedCents === null ? "opacity-40" : ""
                  }`}
                  style={{ width: `${share({ source, model, tokens, estimatedCents })}%` }}
                />
              </span>
            </td>
            <td className="py-3">
              <span
                className={`rounded-full px-2 py-0.5 text-table font-medium ${PILLS[source].className}`}
              >
                {PILLS[source].label}
              </span>
            </td>
            {numericCells(tokens).map((cell, cellIndex) => (
              <td
                key={cellIndex}
                className="py-3 text-right font-mono text-small tabular-nums text-foreground-secondary"
              >
                {cell}
              </td>
            ))}
            <td
              className={`py-3 text-right font-mono font-semibold tabular-nums ${
                index === 0 && estimatedCents !== null ? "text-brand" : ""
              }`}
            >
              {formatCost(estimatedCents)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
