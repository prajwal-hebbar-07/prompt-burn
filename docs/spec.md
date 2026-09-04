# Prompt Burn — implementer contract

Local-only desktop + VS Code dashboard that reads OMP and Cursor token usage and shows what it
would have cost at public pay-as-you-go rates.

- **What and why:** [product.md](product.md) — the full product document. Any conflict, it wins.
- **Build sequence:** [implementation-plan.md](implementation-plan.md) — commit-by-commit plan.
- **Field mappings:** [data-shapes.md](data-shapes.md) — real OMP / Cursor payloads, with fixtures in [`fixtures/`](fixtures).

This page is the short version to keep open while coding. It duplicates no reasoning.

---

## Locked decisions

| Decision | What it means |
|----------|----------------|
| Sources | OMP + Cursor only. Gemini through Antigravity arrives **inside** OMP — `message.provider`, not a third source. |
| Metric | Estimated PAYG cost from tokens × our price DB. Not subscription invoices. |
| OMP accounts | Do not split Claude Pro / Ollama Cloud by account. Model-level breakdown is enough. |
| Cursor Pro | Cycle-to-date per-model aggregates. Calendar filters do **not** apply. Label **"Cycle to date"**. |
| Cursor Enterprise | Optional `crsr_` admin key unlocks per-event timestamps and calendar filters. Not implemented — leave the type union open. |
| Filters | Today, This month (calendar month, not rolling 30 days), All time, Date range (single day = same start and end). Device timezone. Inclusive end day in UI; exclusive next-day 00:00 in code. |
| Combined total | Always shown. Per-source subtotals always shown. No dedupe across OMP + Cursor. |
| By-model table | Rows keyed by `(source, model)`. Same model on both sources = two rows. |
| Fetch | On open + manual button. No background timers. Spinner while fetching; **keep previous data**. Relative "Fetched N min ago". On error: keep old data + banner. |
| Persistence | SQLite at `~/.prompt-burn/db.sqlite`. Outside install dirs so updates/reinstalls keep data. |
| Prices | Usage stores tokens only. Cost is derived from `price_entries` with `effective_from` / `effective_until`. Adding a price retroactively prices old events. Ship bundled Claude + Ollama Cloud + Google Gemini rates. Unknown models surface in Settings. |
| OMP cache | Incremental sync keyed on session-file mtime / offset. |
| VS Code | Opens as an **editor tab** (full width), not a sidebar. |
| Trust | Local only. Never persist Cursor auth tokens in our DB. |

> The Cursor Pro row is contradicted by the spike: the dashboard API **does** accept date windows.
> See [data-shapes.md § Cursor Pro *does* accept date windows](data-shapes.md#finding-cursor-pro-does-accept-date-windows).
> Unchanged until that product decision is made.

> Gemini/Antigravity is an OMP provider value, not an origin: `gemini-3.8-flash` /
> `google-antigravity` / `google-gemini-cli` on ordinary OMP assistant lines, `source: "omp"`.
> See [data-shapes.md § Gemini through Antigravity](data-shapes.md#gemini-through-antigravity--second-scan-2026-09-04).
> Its public Gemini API rates are bundled (`gemini-3.8-flash`, provider `google-antigravity`),
> so those turns price like any other model. Seeds apply on database create only: an existing
> `db.sqlite` needs a delete, or a Settings insert, to pick the row up.

## Mixed periods

Cursor Pro is always cycle-to-date. When the period is Today / This month / Date range:

- OMP total = filtered
- Cursor total = cycle-to-date, **unchanged** — never shrunk to the period
- Grand total = OMP(filtered) + Cursor(cycle), with `mixedPeriod: true`
- The hero **must** name both scopes, e.g. `OMP: Today · Cursor: cycle to date`

Never invent daily splits from cycle aggregates. Cursor cycle rows are stored with
`period = 'cycle'` and no fake timestamps.

## Cost rules

- Unknown price → `estimatedCents: null`, and that row shows `—`, never `$0`.
- A null **total** is not a blank screen: the hero sums the rows that do price and
  shows `≈$X` plus an `N models unpriced` chip. Exact totals never carry `≈`.
- Cursor's own `totalCents` is informational; it never feeds our estimate.
- Never show quota, plan %, or "included pool" numbers.

## Deferred

Cursor Enterprise event ingest · schema migration runner · `model_aliases` table · Projects view ·
quota tiles · source dropdown · auto-refresh · other assistants (OpenCode, Claude Code, Copilot,
OpenRouter) · CSV/JSON export · per-account OMP split · timezone setting.

## Never commit

Cursor access tokens, `crsr_` keys, raw OMP session files, real home paths, `.env`.
Fixtures are redacted samples with field names and structure intact.
