# Prompt Burn — implementer contract

Local-only desktop + VS Code dashboard that reads OMP, Claude Code and Cursor token usage and
shows what it would have cost at public pay-as-you-go rates.

- **What and why:** [product.md](product.md) — the full product document. Any conflict, it wins.
- **Build sequence:** [implementation-plan.md](implementation-plan.md) — commit-by-commit plan.
- **Field mappings:** [data-shapes.md](data-shapes.md) — real OMP / Cursor payloads plus Claude Code's line shape, with fixtures in [`fixtures/`](fixtures).

This page is the short version to keep open while coding. It duplicates no reasoning.

---

## Locked decisions

| Decision | What it means |
|----------|----------------|
| Sources | OMP + Cursor + Claude Code. Gemini through Antigravity arrives **inside** OMP — `message.provider`, not a fourth source. |
| Metric | Estimated PAYG cost from tokens × our price DB. Not subscription invoices. |
| OMP accounts | Do not split Claude Pro / Ollama Cloud by account **for usage or cost** — model-level breakdown is enough. Provider *limits* are per account, because a limit belongs to one subscription; the panel names each by the email OMP recorded, so the account to pin next is readable off the card. No email recorded (an API key) falls back to `Account A` / `B`. |
| Claude Code | The CLI the VS Code extension drives. Transcripts at `~/.claude/projects/**/*.jsonl` — relocatable with `CLAUDE_CONFIG_DIR`, overridable in Settings. Its lines are timestamped, so every calendar filter applies to them exactly as it does to OMP's; never a mixed scope. Own subtotal, own `(source, model)` rows under `source: "claude-code"`, and **never deduped against OMP** — see [Double counting](#double-counting-omp-claude-code-and-the-limit-cards). |
| Cursor Pro | Per-model aggregates, never events. Calendar filters **do** apply: the dashboard API narrows them with `startDate` / `endDate`, so Today / This month / Date range ask Cursor for that window. All time cannot be asked (Cursor refuses a window spanning its own backend boundaries) and shows the billing cycle, labelled **"Cycle to date"**. |
| Cursor Enterprise | Optional `crsr_` admin key unlocks per-event timestamps and calendar filters. Not implemented — leave the type union open. |
| Filters | Today, This month (calendar month, not rolling 30 days), All time, Date range (single day = same start and end). Device timezone. Inclusive end day in UI; exclusive next-day 00:00 in code. |
| Combined total | Always shown. Every **switched-on** source keeps its own subtotal row, even at zero; a source switched off in Settings has no row, no meter segment and no events at all — `DashboardSnapshot.enabled` carries the toggles to the UI. No dedupe across OMP + Claude Code + Cursor. |
| By-model table | Rows keyed by `(source, model)`. The same model on two sources is deliberately two rows. |
| Usage limits | Provider clocks, quoted: Claude's 5-hour / 7-day per account from OMP's `usage_history` (the account clock — Anthropic has already counted Claude Code's turns in it), Ollama Cloud's session / weekly from the undocumented `GET ollama.com/api/usage`, Antigravity's two pools from the undocumented `POST cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary` against `agy`'s own keychain session, Cursor's included-pool percentages from `/api/usage-summary`. Never priced, never period-filtered, never summed with anything, never per-tool. A provider that has not answered has no card; an Ollama or Antigravity failure never fails the fetch. |
| Fetch | On open + manual button. No background timers. Spinner while fetching; **keep previous data**. Relative "Fetched N min ago". On error: keep old data + banner. |
| Persistence | SQLite at `~/.prompt-burn/db.sqlite`. Outside install dirs so updates/reinstalls keep data. |
| Prices | Usage stores tokens only. Cost is derived from `price_entries` with `effective_from` / `effective_until`. Adding a price retroactively prices old events. Ship bundled Claude + Ollama Cloud + Google Gemini rates. Unknown models surface in Settings. |
| Transcript cache | Incremental sync keyed on session-file mtime / offset, in `omp_sync_state`. One table for both transcript sources, keyed by absolute path — the name predates Claude Code and is kept rather than migrated. |
| Settings keys | `omp_enabled` / `omp_path`, `cursor_enabled`, `claude_enabled` / `claude_path` in the `settings` table; an empty path means the collector default. Switching a source off hides it from the dashboard as well as skipping its sync — stored rows stay in the database and come back when it is switched on. |
| VS Code | Opens as an **editor tab** (full width), not a sidebar. |
| Trust | Local only. Never persist Cursor auth tokens in our DB. |

> The Cursor Pro row acts on the spike: the dashboard API **does** accept date windows.
> See [data-shapes.md § Cursor Pro *does* accept date windows](data-shapes.md#finding-cursor-pro-does-accept-date-windows).

> Gemini/Antigravity is an OMP provider value, not an origin: `gemini-3.8-flash` /
> `google-antigravity` / `google-gemini-cli` on ordinary OMP assistant lines, `source: "omp"`.
> See [data-shapes.md § Gemini through Antigravity](data-shapes.md#gemini-through-antigravity--second-scan-2026-09-04).
> Its public Gemini API rates are bundled (`gemini-3.8-flash`, provider `google-antigravity`),
> so those turns price like any other model. Seeds apply on database create only: an existing
> `db.sqlite` needs a delete, or a Settings insert, to pick the row up.

> **Antigravity's *limits* are a fourth fetch, its usage is not.** Unlinking the provider from
> OMP stops `usage_history` gaining `google-antigravity` rows, so the clocks come straight from
> Google — see
> [data-shapes.md § Antigravity quota](data-shapes.md#antigravity-quota--v1internalretrieveuserquotasummary-2026-09-11).
> The credential is `agy`'s keychain item, so the card survives OMP being switched off, and a
> fetched card replaces any `usage_history` rows for the same provider. The quota is
> account-level, so it already counts whatever the standalone CLI burned. Those CLI **turns**
> are still not a usage source: they live in `~/.gemini/antigravity-cli/conversations/*.db`,
> are not read, and so are missing from the cost estimate.

## Double counting: OMP, Claude Code, and the limit cards

The `claude_enabled` toggle exists because "am I seeing the same tokens twice?" is a fair
question. It has two halves, and they answer differently.

**The tokens never overlap, so nothing is deduped.** OMP writes `~/.omp/agent/sessions`;
Claude Code writes `~/.claude/projects`. Two tools, two transcript trees — a turn is recorded
in one of them, never in both. The subtotals are therefore additive, `(source, model)` keeps
the same model on two rows, and both sources are timestamped, so both obey the calendar filter
and both are always inside the combined total. No dedupe key spans them and none is wanted:
deduping would *delete* real usage.

**The subscription does overlap, and that is what the limit cards are.** One Claude account can
pay for both tools. The Claude 5-hour / 7-day cards come from OMP's `usage_history` only
because OMP is the tool that records them — the number itself is Anthropic's own account clock,
and Claude Code's turns are already counted in it. So a limit card is not per-tool, is never
summed with anything, is never period-filtered, and never enters a cost figure. Reading
`Claude 5 Hour: 38%` as "OMP's share" is the one misreading to avoid.

## Mixed periods

A period Cursor can answer for is not a mixed period at all: Today / This month / Date range
each fetch their own window, every source describes the same days, and the grand total is their
sum with `mixedPeriod: false`.

`mixedPeriod: true` is the fallback — Cursor refused, failed, or is signed out, so all that is
on hand is the billing cycle. Then:

- OMP total = filtered
- Claude Code total = filtered, exactly like OMP's — its events are timestamped, so it is never
  the source of a mixed period
- Cursor total = cycle-to-date, **unchanged** — never shrunk to the period
- Grand total = OMP + Claude Code, both filtered, **only**. A 30-day cycle is not part of one
  day's cost, so it is excluded rather than added, and its unpriced rows cannot blank the
  number either
- Cursor's cycle figure stays on its own subtotal row, labelled `Cursor (cycle to date · not in
  total)`
- The hero **must** name both scopes and say which one the number is, e.g.
  `OMP + Claude Code: Today · Cursor: cycle to date (not in total)`

All time is the one period where a cycle total is counted: the scopes do not clash there, so
`mixedPeriod` is false and Cursor is in the sum.

Never invent daily splits from cycle aggregates. Cursor cycle rows are stored with
`period = 'cycle'` and no fake timestamps.

## Cost rules

- Unknown price → `estimatedCents: null`, and that row shows `—`, never `$0`.
- A null **total** is not a blank screen: the hero sums the rows that do price and
  shows `≈$X` plus an `N models unpriced` chip. Exact totals never carry `≈`.
- Cursor's own `totalCents` is informational; it never feeds our estimate.
- Provider limit percentages are the providers' own numbers and live only on the Usage limits
  panel, labelled as provider clocks. They never enter a cost figure, and `$X of $20 plan used`
  is still not a thing this app computes.

## Deferred

Cursor Enterprise event ingest · schema migration runner · `model_aliases` table ·
source dropdown · auto-refresh · other assistants (OpenCode, Copilot, OpenRouter) ·
CSV/JSON export · per-account OMP usage split · timezone setting · our own quota
accounting (spend forecasts, prompts-left estimates).

## Never commit

Cursor access tokens, `crsr_` keys, raw OMP or Claude Code transcripts, real home paths, `.env`.
Fixtures are redacted samples with field names and structure intact.
