/**
 * Price resolution: which rate was valid for a model at a given moment.
 *
 * Usage rows store tokens only, so cost is always a join, never a stored
 * column. That is what makes pricing retroactive — inserting a rate prices
 * every old event on the next lookup, with no rewrite of `usage_events`. A rate
 * that changes is a *new* row with a new `effective_from` (and the previous row
 * closed with `effective_until`), never an UPDATE: an event keeps the rate that
 * was valid when it happened.
 *
 * Unknown model, or no row covering the timestamp, is `null` — the UI shows
 * `—`, never `$0`. Cursor's own `totalCents` never enters this calculation.
 */

import type { DatabaseSync } from "node:sqlite";
import { SEED_EFFECTIVE_FROM } from "./prices.js";

/** A `price_entries` row. Rates are USD per million tokens. */
export interface PriceRate {
  model: string;
  provider: string;
  effectiveFrom: string;
  /** Exclusive: an event exactly at this instant belongs to the next row. */
  effectiveUntil: string | null;
  inputPerMtok: number;
  outputPerMtok: number;
  /** `null` where the vendor publishes no rate — unknown, not free. */
  cacheReadPerMtok: number | null;
  cacheWritePerMtok: number | null;
}

/** Token counts as any source reports them; cache keys absent when zero. */
export interface TokenCounts {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

const SELECT_RATE = `
  SELECT model, provider, effective_from, effective_until,
         input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok
    FROM price_entries
   WHERE model = ?
     AND effective_from <= ?
     AND (effective_until IS NULL OR effective_until > ?)
   ORDER BY effective_from DESC
   LIMIT 1`;

/**
 * The rate valid for `model` at `timestamp`, or `null` when the model is
 * unpriced or no window covers that moment.
 *
 * `timestamp` is an ISO 8601 UTC string: windows are compared as text, which is
 * only ordered if every value is written the same way (`Z`, not `+05:30`).
 * Cursor cycle aggregates have no timestamp and are rejected rather than priced
 * off an empty string. Overlapping windows resolve to the latest
 * `effective_from` — the most recently declared rate wins.
 */
export function resolvePrice(
  db: DatabaseSync,
  model: string,
  timestamp: string,
): PriceRate | null {
  if (timestamp === "") return null;
  const row = db.prepare(SELECT_RATE).get(model, timestamp, timestamp);
  if (!row) return null;
  return {
    model: String(row["model"]),
    provider: String(row["provider"]),
    effectiveFrom: String(row["effective_from"]),
    effectiveUntil: row["effective_until"] === null ? null : String(row["effective_until"]),
    inputPerMtok: Number(row["input_per_mtok"]),
    outputPerMtok: Number(row["output_per_mtok"]),
    cacheReadPerMtok: nullableRate(row["cache_read_per_mtok"]),
    cacheWritePerMtok: nullableRate(row["cache_write_per_mtok"]),
  };
}

/**
 * Cost of `tokens` at `rate`, in cents, or `null` when it cannot be known:
 * no rate at all, or a token kind that is present while its rate column is
 * `NULL`. Cache tokens that are zero or absent never make the estimate unknown.
 *
 * Fractional cents are kept; rounding is the UI's decision.
 */
export function estimateCents(rate: PriceRate | null, tokens: TokenCounts): number | null {
  if (!rate) return null;
  const cacheRead = tokens.cacheRead ?? 0;
  const cacheWrite = tokens.cacheWrite ?? 0;
  if (cacheRead > 0 && rate.cacheReadPerMtok === null) return null;
  if (cacheWrite > 0 && rate.cacheWritePerMtok === null) return null;

  const perMtok =
    tokens.input * rate.inputPerMtok +
    tokens.output * rate.outputPerMtok +
    cacheRead * (rate.cacheReadPerMtok ?? 0) +
    cacheWrite * (rate.cacheWritePerMtok ?? 0);
  // USD per million tokens -> cents.
  return (perMtok / 1_000_000) * 100;
}

/** A hand-entered rate from Settings. USD per million tokens. */
export interface NewPriceEntry {
  model: string;
  provider: string;
  inputPerMtok: number;
  outputPerMtok: number;
  /** `null` when the rate is unknown — the estimate stays `null`, not `0`. */
  cacheReadPerMtok: number | null;
  cacheWritePerMtok: number | null;
}

/**
 * Adds a rate for a model nobody has priced, backdated and open-ended exactly
 * like the bundled seeds.
 *
 * Pricing a model in Settings is a statement about a rate we have no history
 * for, so the window has to cover the events already on disk: a "from now on"
 * row would leave every stored event — and every Cursor cycle aggregate, which
 * has no timestamp at all — showing `—` forever. Correcting a rate later is a
 * second row with a real `effective_from`, never an UPDATE of this one.
 */
export function insertPriceEntry(db: DatabaseSync, entry: NewPriceEntry): void {
  db.prepare(
    `INSERT INTO price_entries
       (model, provider, effective_from, effective_until,
        input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
  ).run(
    entry.model,
    entry.provider,
    SEED_EFFECTIVE_FROM,
    entry.inputPerMtok,
    entry.outputPerMtok,
    entry.cacheReadPerMtok,
    entry.cacheWritePerMtok,
  );
}

function nullableRate(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}
