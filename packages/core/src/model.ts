/**
 * Model id normalization: Cursor `modelIntent` (and OMP `message.model`) to the
 * canonical id the by-model table and price lookups key on.
 *
 * Pure string work, in code — no `model_aliases` table (deferred, see
 * `docs/spec.md`). The Cursor side is unverified beyond the six values observed
 * on one account, so this stays a suffix rule list plus passthrough rather than
 * a model catalog: an id nobody mapped survives unchanged and surfaces as an
 * unknown-price row instead of vanishing.
 */

/**
 * Thinking / effort / speed suffixes named in `docs/data-shapes.md`, in match
 * order. They collapse a Cursor row onto the base model so it can meet the OMP
 * row and the price entry for the same model.
 *
 * Only these two. `-medium` in `gpt-5.6-sol-medium` is not on the list and is
 * left alone, and the `cursor-` prefix is never stripped: those are
 * Cursor-hosted variants that may have no public rate of their own.
 */
const SUFFIX_RULES: ReadonlyArray<readonly [suffix: string, replacement: string]> = [
  // claude-opus-5-thinking-high -> claude-opus-5
  ["-thinking-high", ""],
  // cursor-grok-4.6-high-fast -> cursor-grok-4.6-high
  ["-high-fast", "-high"],
];

/**
 * Canonical id for a raw model string. Unknown ids, OMP ids and Cursor's
 * `default` (Auto — real tokens, no public rate) pass through unchanged.
 */
export function canonicalModelId(rawModel: string): string {
  for (const [suffix, replacement] of SUFFIX_RULES) {
    if (!rawModel.endsWith(suffix)) continue;
    const collapsed = rawModel.slice(0, -suffix.length) + replacement;
    // A bare suffix has no base model to collapse onto; keep it verbatim.
    return collapsed === replacement ? rawModel : collapsed;
  }
  return rawModel;
}
