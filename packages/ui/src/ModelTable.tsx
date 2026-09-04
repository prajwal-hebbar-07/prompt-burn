/**
 * The by-model table: one row per `(source, model)`.
 *
 * The same model on OMP and Cursor is deliberately two rows — sources are
 * never merged and never deduped, here or in the totals. Rows keep the
 * aggregator's first-seen order (the OMP block, then the Cursor block).
 *
 * An unpriceable model stays visible with `—` in the cost cell: Cursor's
 * `default` (Auto) row is the guaranteed case. Pricing it is a Settings job,
 * not this table's.
 */

import type { DashboardSnapshot, Source, TokenCounts } from "@prompt-burn/core";
import { UNKNOWN_COST, formatCost, formatTokens } from "./format.js";

/** Source identity is a color *and* a label, never a color alone. */
const PILLS: Record<Source, { label: string; className: string }> = {
  omp: { label: "OMP", className: "bg-source-omp-subtle text-source-omp" },
  cursor: { label: "Cursor", className: "bg-source-cursor-subtle text-source-cursor" },
};

const COLUMNS = ["Model", "Source", "In", "Out", "Cache R", "Cache W", "Est. cost"];

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

export interface ModelTableProps {
  rows: DashboardSnapshot["models"];
}

export function ModelTable({ rows }: ModelTableProps) {
  return (
    <table data-testid="model-table" className="w-full border-collapse text-body">
      <caption className="sr-only">Estimated cost by source and model</caption>
      <thead>
        <tr className="border-b border-border">
          {COLUMNS.map((column, index) => (
            <th
              key={column}
              scope="col"
              className={`py-2 text-table leading-table font-medium tracking-wide text-foreground-muted uppercase ${
                index < 2 ? "text-left" : "text-right"
              }`}
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(({ source, model, tokens, estimatedCents }) => (
          <tr
            key={`${source}:${model}`}
            data-testid={`model-row-${source}-${model}`}
            className="border-b border-border last:border-0"
          >
            <td className="py-2 font-mono text-small">{model}</td>
            <td className="py-2">
              <span
                className={`rounded-full px-2 py-0.5 text-table font-medium ${PILLS[source].className}`}
              >
                {PILLS[source].label}
              </span>
            </td>
            {numericCells(tokens).map((cell, index) => (
              <td key={index} className="py-2 text-right tabular-nums text-foreground-secondary">
                {cell}
              </td>
            ))}
            <td className="py-2 text-right font-medium tabular-nums">
              {formatCost(estimatedCents)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
