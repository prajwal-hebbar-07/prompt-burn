# Product plan and locked decisions

> **Plain English:** [02-the-blueprint.md](../plain-english/02-the-blueprint.md)

## 1. Purpose

The repo has no packages yet — it has a signed plan. This document covers the planning corpus as
an area of the codebase: what each planning document owns, how they cross-reference, and the
locked-decisions table every later commit must obey. The table is the contract between the
product intent and the build sequence; when it changes, everything downstream changes with it.

Sources, in authority order (repo-relative):

- `docs/product.md` — the product document. Wins on conflict.
- `docs/implementation-plan.md` — commit-by-commit build sequence.
- `docs/spec.md` — short implementer contract; duplicates no reasoning, points at the other two.
- `docs/data-shapes.md` — the data-shape spike that verified the assumptions behind several rows.

## 2. Inventory

- `README.md` — entry point. Links [product.md](../../docs/product.md) and
  [implementation-plan.md](../../docs/implementation-plan.md); does not link `spec.md` or
  `data-shapes.md`.
- `docs/product.md` — what and why. 229 lines. Links the plan, names the Paper wireframes, and
  carries the 2026-09-02 spike pointer.
- `docs/implementation-plan.md` — how to build. Phases 0–8, commits 1–30, 7 PRs, locked table,
  mixed-period rules, schema sketch, deferred list. Carries the same spike pointer.
- `docs/spec.md` — coding-time contract. 64 lines. Restates the locked table verbatim plus cost
  rules, deferred list, never-commit list. Links product, plan, and data-shapes.
- `docs/data-shapes.md` — spike findings. OMP JSONL mapping, Cursor Pro payload mapping, the
  date-window finding, assumed/unknown list, re-run instructions.

Cross-references: `product.md` links the implementation plan; `spec.md` points at product, plan,
and data-shapes; the plan links `product.md`; `data-shapes.md` names both fixtures and the two
docs that carry its finding pointer. No doc links `spec.md` back — it is reached from the top of
the coding session, not from the other docs.

## 3. Public surface

There is no code surface. The public surface of this area is the locked-decisions list, stated
in `docs/implementation-plan.md` (§ Locked product decisions) and restated in `docs/spec.md`
(§ Locked decisions):

- **Sources** — OMP + Cursor only; no other assistants.
- **Metric** — estimated pay-as-you-go cost from tokens × the local price DB. Never invoices,
  never Cursor's own cents.
- **OMP accounts** — no per-account split (two Claude Pro subscriptions + one Ollama Cloud key in
  this household); model-level breakdown is enough.
- **Cursor Pro** — cycle-to-date per-model aggregates, labeled "Cycle to date". Calendar filters
  do **not** apply.
- **Cursor Enterprise** — an optional `crsr_` admin key would unlock per-event timestamps and
  calendar filters. Not in this plan; the type union stays open.
- **Filters** — Today, This month (calendar month, not rolling 30 days), All time, Date range.
  Device timezone. Inclusive end day in the UI; exclusive next-midnight in code.
- **Combined total** — always shown, with per-source subtotals. No dedupe across OMP + Cursor;
  same work in both tools may inflate the total — accepted.
- **By-model table** — rows keyed by `(source, model)`; the same model on both sources is
  two rows.
- **Fetch** — on open + manual button only. Keep previous data while fetching and on error
  (banner + Retry). No background timers.
- **Persistence** — SQLite at `~/.prompt-burn/db.sqlite`, outside install dirs so reinstalls keep
  data. Both shells share it.
- **Prices** — usage rows store tokens only; cost is computed at display time from `price_entries`
  with `effective_from` / `effective_until`. Retroactive pricing works — inserting a price
  re-prices old events without rewriting usage rows. Unknown models surface in Settings; unknown
  cost shows `—`, never `$0`.
- **OMP cache** — incremental sync keyed on session-file mtime / offset.
- **VS Code** — full-width editor tab, not a sidebar.
- **Trust** — local only. Never persist Cursor auth tokens in the DB; read them from Cursor's own
  local state at fetch time.

The mixed-period consequence is part of the same contract: when the period is not all-time and
Cursor is Pro, the grand total is OMP(filtered) + Cursor(cycle) and the hero must label both
scopes (e.g. `OMP: Today · Cursor: cycle to date`). Never invent daily splits from cycle
aggregates; cycle rows are stored with `period = 'cycle'` and no fake timestamps.

## 4. Flow

Reading order as the repo is consumed today:

1. `README.md` → `docs/product.md` (what) → `docs/implementation-plan.md` (how).
2. `docs/spec.md` is opened separately at coding time; it links product, plan, and data-shapes
   but nothing links back to it.
3. `docs/data-shapes.md` is the spike output the plan's Phase 0 made blocking: commit 2 records
   the spike, and commit 4 (domain types) is forbidden until the fixtures exist
   ([docs/implementation-plan.md](../../docs/implementation-plan.md), Phase 0 note).

Build flow encoded by the plan: Phases 0–8 = foundation → core → db → OMP collector →
desktop vertical slice (commits 12–15 produce the first usable app, OMP only) → UI on typed
mocks → Cursor collectors + orchestrator → VS Code → settings writes + hardening. PRs group
commits 1–30 into 7 batches; PR 3 delivers the first runnable app.

Decision flow when the plan conflicts with reality: the spike already demonstrated it — a finding
is written into `docs/data-shapes.md`, a pointer is added to the affected planning docs, and the
locked table stays unchanged until a product decision is made.

## 5. Contracts and invariants

- The locked table is restated in two places (`implementation-plan.md`, `spec.md`) and must stay
  in sync; `product.md` is the tiebreaker. There is no mechanism enforcing this — three humans
  readable copies of the same truth.
- `product.md` wins on conflict with any other doc, including the plan's own locked table.
- The spike finding is a standing contradiction, not an edit: `docs/data-shapes.md`
  ([§ Finding](../../docs/data-shapes.md#finding-cursor-pro-does-accept-date-windows)) proved the
  Cursor Pro API **does** accept `startDate` / `endDate` windows, contradicting the locked
  "Pro = cycle only" row. All three planning docs carry a deliberate not-acting pointer
  (`product.md` line ~81, `implementation-plan.md` line ~28, `spec.md` line ~33). Cycle-aggregate
  mode remains the correct subset either way and `CursorSnapshot` keeps the union open.
- Mixed-period is a UI contract even before any code exists: grand total = OMP filtered +
  Cursor cycle, hero names both scopes, no daily splits invented from cycle aggregates.
- Cost display: unknown price → `—`, never `$0`. Cursor's own cents are informational only.
- Never commit Cursor access tokens, `crsr_` keys, raw session files, real home paths, `.env`;
  fixtures are redacted with structure intact.

## 6. Configuration

No runtime configuration exists yet — the app is unbuilt. The planning corpus itself fixes the
future configuration surface:

- Database location: `~/.prompt-burn/db.sqlite`, outside install dirs.
- Settings screen (planned): OMP on/off + path override (default `~/.omp/agent/sessions/`),
  Cursor on/off + Pro/Enterprise status, optional `crsr_` key, pricing table with unknown-model
  `Add price`, About showing the DB path.
- Deliberately absent: no timezone setting (device timezone only), no auto-refresh toggle,
  no source dropdown.
- Spike tooling: `node scripts/spike/dump-shapes.mjs` prints shapes (never the token);
  with an output-dir argument it writes raw **unredacted** dumps to `out/` (gitignored).

## 7. Boundaries and dependencies

- The planning docs are the only authority for product behaviour until code exists; wireframes
  live outside the repo (Paper, `prompt-burn` / `v0-wireframes`).
- `docs/spec.md` intentionally duplicates the locked table instead of linking it, so it can be
  kept open while coding without cross-doc hops; the cost is the sync burden noted in §5.
- The spike is a hard gate in the build sequence, not advisory material: commit 4 freezes domain
  types and cannot start until OMP and Cursor fixtures are on disk.
- The repo currently has no test suite, no CI, and no prettier config; the plan defers CI to
  "later if wanted" and the spike script is the only runnable artifact in the repo
  ([scripts/spike/dump-shapes.mjs](../../scripts/spike/dump-shapes.mjs)).

## 8. Tests

Nothing in this area is covered by tests — there is no test suite in the repo, and no doc
correctness is checked mechanically:

- Not covered: consistency of the three locked-table copies; validity of doc links (e.g. the
  spike anchor `#finding-cursor-pro-does-accept-date-windows` is hand-written in three places);
- Not covered: any claim in `docs/data-shapes.md` — it is single-machine evidence from
  2026-09-02, and its own "Assumed / unknown" section lists what is not verified (alias mapping,
  Cursor cache-token pricing semantics, `teamId: 0` on real teams, OMP format version stability).
- The plan's commit 30 (golden aggregation snapshots) is the first planned regression lock;
  until then every guarantee here is prose.

## 9. Debt and traps

- **The locked table contains a factually wrong row, on purpose.** "Cursor Pro calendar filters
  do not apply" was disproved by the spike: the API accepts `startDate` / `endDate` windows,
  including pre-cycle windows. All three planning docs still build as if it were true, with
  pointer notes saying so. This is the right call (it is a product decision, not a bug fix) but
  it means every reader must know the table is knowingly stale in one row.
- **The mixed-period consequence is a permanent UI obligation.** While Pro stays cycle-only,
  the hero must label both scopes and never invent daily splits from cycle aggregates. Any future
  change that applies date windows to Cursor must revisit this whole section, the cycle banner,
  and the mixed-period subtitle at once.
- **Three copies of the locked table will drift.** `implementation-plan.md` and `spec.md` both
  restate it verbatim with no sync check. A one-row edit must land in both plus be validated
  against `product.md`.
- **`spec.md` is an orphan link-wise.** Nothing links to it; it is discoverable only by habit.
  `README.md` links only product + plan.
- **Date-window constraint discovered but unused.** A window may not span both 2025-08-01 and
  2026-05-14 (backend constraint; all-time would need up to three merged calls). Relevant the
  moment the not-acting decision is revisited; easy to re-forget because no doc outside the
  spike records it.
- **`default` (Auto) model has real tokens and no public rate** — the unknown-price `—` path is
  a guaranteed first-class state, not an edge case.
- **The spike script can write unredacted dumps** when given an output dir; the safety depends
  on `out/` staying gitignored and on nobody committing its contents.

## 10. Change guide

- Adding or changing a product decision: edit the table in `docs/product.md` (authority), then
  mirror the row in `docs/implementation-plan.md` § Locked product decisions and `docs/spec.md`
  § Locked decisions in the same commit. If a data-shape assumption is involved, re-run the
  spike before locking.
- Resolving the Cursor Pro date-window question: decide in `product.md`, update all three
  locked-table copies, update or remove the three spike pointers, and revise the mixed-period
  contract + UI edge-case table together. All-time fetching gains the split-window constraint.
- Adding a deferred feature (Projects view, quota tiles, source dropdown, auto-refresh,
  migration runner, CSV export, other assistants, timezone setting, per-account OMP split,
  Enterprise ingest): remove it from the deferred list in both `product.md` and
  `implementation-plan.md` (and `spec.md`'s Deferred line), then extend the plan's commit
  sequence — do not silently build it.
- Changing commit structure: `docs/implementation-plan.md` is the only owner of Phases, commit
  numbers, and PR grouping; keep the PR table consistent with the commit tables when renumbering.
- The spike (`docs/data-shapes.md` + `scripts/spike/dump-shapes.mjs` + `docs/fixtures/`) is a
  dated snapshot of 2026-09-02 on one machine. Re-run it before trusting any of its findings for
  a new decision; treat its "Assumed / unknown" list as open questions, not facts.