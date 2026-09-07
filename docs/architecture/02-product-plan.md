# Product plan and locked decisions

> **Plain English:** [02-the-blueprint.md](../plain-english/02-the-blueprint.md)

## 1. Purpose

The planning corpus predates the code and still governs it. This document covers that corpus as
an area: what each planning document owns, how they cross-reference, the locked-decisions table
every later commit must obey, and — since the sweep baseline — how far the build sequence has
actually got. The table is the contract between the product intent and the build sequence; when
it changes, everything downstream changes with it.

Code inventory is not here: `packages/core`, `packages/db`, `packages/collectors`, and
`apps/desktop` each get their own numbered pair (04+) as the docs sweep reaches them.

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

The numbered doc pairs (01–03 at this baseline) now sit alongside the corpus: `docs/README.md`
separates the two input documents from the pairs that document what exists. That file, and the
pair READMEs, are owned by the docs sweep, not by this pair.

## 3. Public surface

The product-facing surface of this area is still the locked-decisions list, stated in
[docs/implementation-plan.md](../../docs/implementation-plan.md) (§ Locked product decisions) and
restated in `docs/spec.md` (§ Locked decisions):

- **Sources** — OMP + Cursor only; no other assistants.
- **Metric** — estimated pay-as-you-go cost from tokens × the local price DB. Never invoices,
  never Cursor's own cents.
- **OMP accounts** — no per-account split of usage or cost (two Claude Pro subscriptions + one
  Ollama Cloud key in this household); model-level breakdown is enough. Provider *limits* are the
  exception: a subscription window belongs to an account, so the Usage limits panel shows one
  block per account, named by the email OMP recorded in `usage_history` so the right
  subscription can be pinned; `Account A` / `B` remains the fallback when there is no email.
- **Cursor Pro** — per-model aggregates, never events. Calendar filters **do** apply: the
  dashboard API narrows the aggregate with `startDate` / `endDate`, so Today / This month / Date
  range each fetch their own window. All time cannot be asked (an unbounded window is refused)
  and shows the billing cycle, labeled "Cycle to date".
- **Cursor Enterprise** — an optional `crsr_` admin key would unlock per-event timestamps and
  calendar filters. Not in this plan; the type union stays open.
- **Filters** — Today, This month (calendar month, not rolling 30 days), All time, Date range.
  Device timezone. Inclusive end day in the UI; exclusive next-midnight in code.
- **Combined total** — always shown, with per-source subtotals. It covers only what the period
  covers: a Cursor billing cycle standing against a narrower period is excluded from it and
  shown on its own row. No dedupe across OMP + Cursor; same work in both tools may inflate the
  total — accepted.
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
- **Usage limits** — provider clocks, quoted: Claude's 5-hour / 7-day per account from OMP's
  `usage_history`, Ollama Cloud's session / weekly from the undocumented `ollama.com/api/usage`,
  Cursor's included-pool percentages from `/api/usage-summary`. Never priced, never
  period-filtered, never summed. A provider that has not answered gets no card, and a failed
  Ollama call never fails the fetch pass.

The mixed-period consequence is part of the same contract, and it is now the *fallback* rather
than the norm: when Cursor answered for the period, both sources share one scope and the grand
total is their sum. When it could not — signed out, HTTP failure, refused window — the grand
total is OMP(filtered) alone, the cycle keeps its own row, and the hero must label both scopes
and say which one the number is (e.g. `OMP: Today · Cursor: cycle to date (not in total)`).
All-time is the one period that counts a cycle total. Never invent daily splits from cycle
aggregates; cycle rows are stored with `period = 'cycle'` and no fake timestamps.

### Build-sequence status as of 325b156

The plan's rows 1–12 have landed; the code that realizes each lives in the packages the pairs 04+
will inventory:

| Plan rows                                                                                  | State                                               |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| 1–3 (foundation, docs, scripts)                                                            | Landed before the docs baseline; `pnpm typecheck` / |
| `pnpm test` exist and pass.                                                                |
| 4–7 (core: types, period filter, model-id map, aggregation)                                | Landed. `DashboardSnapshot`,                        |
| `mixedPeriod`, and the cycle label constant exist as planned.                              |
| 8–9 (db: SQLite at `~/.prompt-burn`, schema, bundled prices, point-in-time resolution,     |
| `estimateCents`)                                                                           | Landed — with one deliberate divergence, see §7.    |
| 10–11 (collectors: OMP JSONL parse, incremental sync)                                      | Landed.                                             |
| 12 (desktop: Tauri v2 window + Node sidecar that opens the DB)                             | Landed. The sidecar prints a                        |
| readiness line; no fetch and no UI number yet.                                             |
| 13–15 (UsageReader on the sidecar, first UI total, fetch-on-open)                          | Pending — finishing these                           |
| completes the first runnable, usable app.                                                  |
| 16–21 (UI on typed mocks), 22–24 (Cursor + orchestrator), 25–27 (VS Code), 28–30 (settings |
| writes, error banner, goldens)                                                             | Pending.                                            |

Everything after row 12 is untouched; nothing out of plan order has been built.

## 4. Flow

Reading order as the repo is consumed today:

1. `README.md` → `docs/product.md` (what) → `docs/implementation-plan.md` (how).
2. `docs/spec.md` is opened separately at coding time; it links product, plan, and data-shapes
   but nothing links back to it.
3. `docs/data-shapes.md` is the spike output the plan's Phase 0 made blocking. That gate has now
   been passed — the fixtures exist, commits 4+ froze types on top of them, and the spike
   findings are re-checked by pair 03.

Build flow encoded by the plan, with status: Phases 0–3 are done (foundation → core → db →
OMP collector). Phase 4 is half done: commit 12 produced the Tauri window and the sidecar
opening the database, but the slice is only "runnable", not yet "usable" — commits 13–15 must
add the reader, the first rendered total, and fetch-on-open before the plan's first milestone
is met.
Phases 5–8 (UI on mocks, Cursor + orchestrator, VS Code, settings writes + hardening) have not
started. PRs group commits 1–30 into 7 batches; PR 3 (commits 10–15) is the first usable app and
is in progress.

Decision flow when the plan conflicts with reality: the spike already demonstrated it — a finding
is written into `docs/data-shapes.md`, a pointer is added to the affected planning docs, and the
locked table stays unchanged until a product decision is made.

## 5. Contracts and invariants

- The locked table is restated in two places (`implementation-plan.md`, `spec.md`) and must stay
  in sync; `product.md` is the tiebreaker. There is no mechanism enforcing this — three human-
  readable copies of the same truth.
- `product.md` wins on conflict with any other doc, including the plan's own locked table.
- The spike finding is no longer a standing contradiction: `docs/data-shapes.md`
  ([§ Finding](../../docs/data-shapes.md#finding-cursor-pro-does-accept-date-windows)) proved the
  Cursor Pro API **does** accept `startDate` / `endDate` windows, and as of 2026-09-07 the
  product does that — the three locked-table copies say filters apply, and the plan carries it as
  commit 40. What survives of the old subset rule is all-time, where an unbounded window is
  refused and the cycle stands in.
- Mixed-period is a code contract as well as a UI one, and it now decides arithmetic rather than
  only copy: `DashboardSnapshot.mixedPeriod` marks a Cursor cycle standing against a narrower
  period, and `estimatedCents` excludes Cursor whenever it is set. `CursorSnapshot.window` is
  what clears it.
- Cost display: unknown price → `—`, never `$0`. Cursor's own cents are informational only. The
  db package's `estimateCents` returns `null` for unknown prices, matching the rule.
- Never commit Cursor access tokens, `crsr_` keys, raw session files, real home paths, `.env`;
  fixtures are redacted with structure intact.

## 6. Configuration

Runtime configuration is still just the database location and the workspace scripts; the Settings
screen is not built:

- Database location: `~/.prompt-burn/db.sqlite`, outside install dirs — implemented.
- Workspace scripts: `pnpm typecheck` / `pnpm test` fan out into every package; Node 24 is
  required (`engines` + `.nvmrc`), which is what makes the db divergence in §7 possible.
- Settings screen (planned, not built): OMP on/off + path override (default
  `~/.omp/agent/sessions/`), Cursor on/off + Pro/Enterprise status, optional `crsr_` key, pricing
  table with unknown-model `Add price`, About showing the DB path.
- Deliberately absent: no timezone setting (device timezone only), no auto-refresh toggle,
  no source dropdown.
- Spike tooling: `node scripts/spike/dump-shapes.mjs` prints shapes (never the token);
  with an output-dir argument it writes raw **unredacted** dumps to `out/` (gitignored).

## 7. Boundaries and dependencies

- The planning docs remain the authority for product behaviour; for code behaviour the pairs 04+
  now document what is real. Wireframes live outside the repo (Paper, `prompt-burn` /
  `v0-wireframes`).
- `docs/spec.md` intentionally duplicates the locked table instead of linking it, so it can be
  kept open while coding without cross-doc hops; the cost is the sync burden noted in §5.
- The spike was a hard gate in the build sequence; the gate has been passed and the fixture files
  it produced are on disk and used by the collectors' tests.
- **Deliberate divergence, now real:** the plan's architecture sketch says `packages/db` uses
  `better-sqlite3` (and repeats it in the "Why a Node sidecar" note). The shipped db package
  instead uses Node's built-in `node:sqlite` (`DatabaseSync`), which Node 24 provides. This keeps
  the workspace dependency-free — root `package.json` has no runtime dependencies and the db
  package none at all — and matches the spike's dependency-free approach. The plan text still
  says `better-sqlite3` and has not been edited; treat the code as authoritative here. One
  consequence is deferred, not decided: reading Cursor's `state.vscdb` (commit 22) was the reason
  the plan picked `better-sqlite3`, and how that read happens is still an open choice.
- The repo has typecheck and vitest test suites in every landed package; it still has no CI and
  no prettier config, as the plan intended ("CI later if wanted").

## 8. Tests

The locked decisions are prose, but the code that landed against them now carries tests:

- Covered by shipped suites: calendar period filtering (month boundaries, single-day ranges),
  model-id normalization, aggregation with the `mixedPeriod` flag, bundled-price seeding,
  point-in-time price resolution including retroactive pricing, OMP JSONL parsing, incremental
  sync skipping unchanged files, and the sidecar's database open. All pass at 325b156.
- Not covered mechanically: consistency of the three locked-table copies; validity of doc links
  (the spike anchor `#finding-cursor-pro-does-accept-date-windows` is hand-written in three
  places); any claim in `docs/data-shapes.md` — it is single-machine evidence from 2026-09-02,
  and its own "Assumed / unknown" section lists what is not verified (alias mapping, Cursor
  cache-token pricing semantics, `teamId: 0` on real teams, OMP format version stability).
- The plan's commit 30 (golden aggregation snapshots) remains the planned regression lock on top
  of the existing unit suites.

## 9. Debt and traps

- **The locked table no longer contradicts the spike.** "Cursor Pro calendar filters do not
  apply" was disproved by the spike and the product now follows the API: Today / This month /
  Date range send `startDate` / `endDate`. What is left of the old rule is all-time, which
  cannot be asked for. The three planning copies were updated together on 2026-09-07; a reader
  who remembers the old pointer notes should expect them gone.
- **The plan's db text is stale in one place.** The `better-sqlite3` mentions in the
  architecture sketch and sidecar rationale describe a library the code does not use; §7 records
  the divergence. If anyone re-reads the plan without this doc, they will think a dependency is
  coming that never will be. Fixing the plan text is a docs-sweep decision, not a drive-by.
- **The mixed-period consequence is a permanent UI obligation, and now an arithmetic one.**
  Whenever only a cycle total is on hand for a narrower period, the hero must label both scopes,
  say the cycle is not in the total, and actually leave it out — `estimatedCents` drops Cursor
  while `mixedPeriod` is set. Any change to windowed fetching must revisit that flag, the cycle
  banner, the hero subtitle and the subtotal label at once.
- **Three copies of the locked table will drift.** `implementation-plan.md` and `spec.md` both
  restate it verbatim with no sync check. A one-row edit must land in both plus be validated
  against `product.md`.
- **`spec.md` is an orphan link-wise.** Nothing links to it; it is discoverable only by habit.
  `README.md` links only product + plan.
- **The all-time window is still unaskable.** A window may not span both 2025-08-01 and
  2026-05-14 (backend constraint), so all-time keeps sending `{}` and shows the cycle. Working
  around it means up to three merged calls keyed on two account-specific dates that exist only
  in an error message — deliberately not hard-coded.
- **`default` (Auto) model has real tokens and no public rate** — the unknown-price `—` path is
  a guaranteed first-class state, and the shipped `estimateCents` null path is its code half.
- **The spike script can write unredacted dumps** when given an output dir; the safety depends
  on `out/` staying gitignored and on nobody committing its contents.
- **The desktop slice is half-landed.** The Tauri window opens and the sidecar proves the DB,
  but nothing user-visible works yet. Anyone testing "the app" at this commit sees a placeholder
  page — that is the plan's intended state between rows 12 and 13, not a bug.

## 10. Change guide

- Adding or changing a product decision: edit the table in `docs/product.md` (authority), then
  mirror the row in `docs/implementation-plan.md` § Locked product decisions and `docs/spec.md`
  § Locked decisions in the same commit. If a data-shape assumption is involved, re-run the
  spike before locking.
- Changing how Cursor follows the calendar: the window comes from `periodBounds` in
  `packages/core`, is fetched by `fetchCursorWindowAggregate`, and is resolved per period in
  `createUsageReader`. A change there must move `mixedPeriod`, the hero subtitle, the cycle
  footnote, the subtotal label and the golden snapshots together — they encode one contract.
- Adding a deferred feature (source dropdown, auto-refresh, migration runner,
  CSV export, other assistants, timezone setting, per-account OMP usage split, Enterprise
  ingest): remove it from the deferred list in both `product.md` and `implementation-plan.md`
  (and `spec.md`'s Deferred line), then extend the plan's commit sequence — do not silently
  build it. Quota tiles left that list in commit 38, as the Usage limits panel.
- Changing commit structure: `docs/implementation-plan.md` is the only owner of Phases, commit
  numbers, and PR grouping; keep the PR table consistent with the commit tables when renumbering.
- Marking further rows landed: advance the §3 status table only from a docs sweep that has read
  the corresponding code pairs; do not update it commit-by-commit.
- The spike (`docs/data-shapes.md` + `scripts/spike/dump-shapes.mjs` + `docs/fixtures/`) is a
  dated snapshot of 2026-09-02 on one machine. Re-run it before trusting any of its findings for
  a new decision; treat its "Assumed / unknown" list as open questions, not facts.
