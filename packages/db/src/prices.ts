/**
 * Bundled pay-as-you-go rates, seeded once when the database is created.
 *
 * USD per million tokens, straight from the vendors' public price pages:
 * - Claude — https://platform.claude.com/docs/en/about-claude/pricing
 *   (5-minute cache writes; cache hits are the 0.1x column), read 2026-09-04.
 * - Ollama Cloud — https://ollama.com/pricing, per-model input / cached-input /
 *   output, read 2026-09-04. Standard rates, not the deepseek peak window.
 *   Ollama Cloud is priced like any other vendor here; OMP reporting
 *   `cost.total: 0` on those lines does not make the tokens free.
 * - Google Gemini — https://ai.google.dev/gemini-api/docs/pricing, standard
 *   (not batch / flex / priority) paid-tier rates, read 2026-09-04. Reached
 *   through Antigravity inside OMP, so `provider` carries OMP's own
 *   `google-antigravity` slot rather than a bare vendor name.
 * - xAI Grok — https://docs.x.ai/developers/pricing, standard (<200K context)
 *   rates, read 2026-09-05.
 * - OpenAI — https://developers.openai.com/api/docs/models/gpt-5.6-sol, read
 *   2026-09-05.
 * - Cursor Composer — https://cursor.com/docs/models-and-pricing, the rates
 *   Cursor bills once included usage runs out, read 2026-09-05.
 *
 * Models keyed by canonical id (`canonicalModelId` in `@prompt-burn/core`), the
 * same string OMP writes. Anything not listed prices as unknown — `—` in the
 * UI, and a row in Settings to price by hand.
 */

/** Seeds are backdated so existing session logs price; see `SEED_EFFECTIVE_FROM`. */
export interface BundledPrice {
  model: string;
  provider: string;
  inputPerMtok: number;
  outputPerMtok: number;
  /** `null` where the vendor publishes no rate — priced as unknown, not free. */
  cacheReadPerMtok: number | null;
  cacheWritePerMtok: number | null;
}

/**
 * The bundled rows carry no start date of their own: they are the currently
 * published rates and we have no history for them, so they are backdated to
 * price every event we can already see. A future rate change closes the row
 * with `effective_until` and inserts a new one with a real date.
 */
export const SEED_EFFECTIVE_FROM = "1970-01-01T00:00:00Z";

export const BUNDLED_PRICES: readonly BundledPrice[] = [
  // Anthropic: input / output / cache hit / 5m cache write.
  price("claude-opus-5", "anthropic", 5, 25, 0.5, 6.25),
  price("claude-sonnet-5", "anthropic", 2, 10, 0.2, 2.5),
  price("claude-sonnet-4-5", "anthropic", 3, 15, 0.3, 3.75),
  price("claude-haiku-4-5", "anthropic", 1, 5, 0.1, 1.25),
  // Ollama Cloud: input / output / cached input. Standard rates — deepseek's
  // peak window (12:00-18:00 UTC, Mon-Fri, double price) is not modelled, so
  // peak-hour deepseek usage under-estimates by 2x.
  // Cache writes are 0 because Ollama publishes no such category at all: the
  // first pass is billed as plain input and reuse is billed as cached input.
  price("glm-5.3", "ollama-cloud", 1.4, 4.4, 0.26, 0),
  price("glm-5.3-flash", "ollama-cloud", 0.15, 0.5, 0.03, 0),
  price("deepseek-v4-pro", "ollama-cloud", 0.66, 1.98, 0.022, 0),
  price("deepseek-v4-flash", "ollama-cloud", 0.22, 0.66, 0.007, 0),
  price("kimi-k3", "ollama-cloud", 3, 15, 0.3, 0),
  price("kimi-k2.7-code", "ollama-cloud", 0.95, 4, 0.19, 0),
  price("minimax-m3", "ollama-cloud", 0.6, 2.4, 0.12, 0),
  // Ollama lists no cached-input rate for qwen3.5 — unknown, never guessed.
  price("qwen3.5:397b", "ollama-cloud", 0.6, 3.6, null, 0),
  price("gpt-oss:120b", "ollama-cloud", 0.15, 0.6, 0.014, 0),
  price("gpt-oss:20b", "ollama-cloud", 0.07, 0.3, 0.035, 0),
  // `gemma4` is Google's open model served by Ollama Cloud — not Google Gemini.
  price("gemma4", "ollama-cloud", 0.14, 0.4, 0.05, 0),
  // Google Gemini via Antigravity: input / output (thinking included) / context
  // caching. These are the intro rates published through 2026-12-31; every rate
  // listed doubles on 2027-01-01, which is a close-and-insert (a second row
  // with a real `effective_from`), never an edit of this one.
  // Cache write is 0 because Google has no per-token cache-write category: an
  // implicit cache costs input, and an explicit one is billed as storage per
  // hour, which is not a token count and is not modelled. OMP reports
  // `cacheWrite: 0` on every Gemini line, so nothing is silently dropped.
  price("gemini-3.8-flash", "google-antigravity", 0.75, 3.75, 0.075, 0),
  // Cursor-side models. The ids are Cursor's own `modelIntent` strings, kept
  // verbatim by `canonicalModelId`, and they are priced at the *public* rate of
  // whoever runs the model — the same choice already made for Gemini through
  // Antigravity. Cursor's subscription pool bills differently; this product
  // estimates PAYG cost, not the invoice.
  //
  // xAI Grok via Cursor: input / output / cached input. Effort levels (`-high`,
  // `-xhigh`) are the same model at the same token price, so they carry the same
  // row. Cache write is 0: xAI publishes no cache-write category.
  // Under-estimates a request over 200K context, where every xAI rate doubles.
  price("cursor-grok-4.6-high", "xai", 2, 6, 0.5, 0),
  price("cursor-grok-4.6-xhigh", "xai", 2, 6, 0.5, 0),
  price("cursor-grok-4.5-high", "xai", 2, 6, 0.3, 0),
  // Cursor's own model. The `-fast` variant is billed at 3 / 15 / 0.5 and
  // arrives as its own `modelIntent`, so it is not this row and stays unpriced
  // until it is actually observed.
  price("composer-2.5", "cursor", 0.5, 2.5, 0.2, 0),
  // OpenAI GPT-5.6 Sol. `-medium` is reasoning effort, which does not change
  // the token price. Cache write is 0: OpenAI caches automatically and bills no
  // write.
  price("gpt-5.6-sol-medium", "openai", 5, 30, 0.5, 0),
  // Anthropic Haiku 4.5 under Cursor's id. Same rates as the `claude-haiku-4-5`
  // row above; `-thinking` is a mode, not a price tier.
  price("claude-4.5-haiku-thinking", "anthropic", 1, 5, 0.1, 1.25),
  // Not bundled: `default` (Cursor Auto) routes to whichever model Cursor
  // chooses per request. There is no rate to publish, so it stays `—` and is
  // priced by hand in Settings or not at all.
];

function price(
  model: string,
  provider: string,
  inputPerMtok: number,
  outputPerMtok: number,
  cacheReadPerMtok: number | null,
  cacheWritePerMtok: number | null,
): BundledPrice {
  return { model, provider, inputPerMtok, outputPerMtok, cacheReadPerMtok, cacheWritePerMtok };
}
