# Product plan and locked decisions

> **Plain English:** [The blueprint](../plain-english/02-the-blueprint.md)

## 1. Purpose

The planning corpus predates the code and still governs it. This document covers that corpus as
an area: what each planning document owns, how they cross-reference, the locked-decisions table
every commit must obey, and the status of the implementation phases through release v1.1.0.
The table is the contract between the product intent and the build sequence; when it changes,
everything downstream changes with it.

Code inventory is not here: `packages/core`, `packages/db`, `packages/collectors`,
`packages/reader`, `packages/ui`, `apps/desktop`, and `apps/vscode` each have their own numbered
pair (04–10) in the documentation corpus.

Sources, in authority order (repo-relative):

- `docs/product.md` — the product document. Wins on conflict.
- `docs/spec.md` — short implementer contract; duplicates no reasoning, points at the others.
- `docs/release.md` — release automation, version source of truth, workflow dispatch, artifacts.
- `docs/data-shapes.md` — data-shape spikes and scan findings (OMP, Claude Code, Cursor, limits).

## 2. Inventory

- `README.md` — entry point. Links [product.md](../../docs/product.md) and
  [docs/README.md](../../docs/README.md).
- `docs/product.md` — what and why. 264 lines. Names the Paper wireframes,
  defines the three routes (Dashboard, Projects, Settings), surfaces, metrics, local persistence,
  trust copy, and out-of-scope list.
- `docs/spec.md` — coding-time contract. 123 lines. Restates the locked table verbatim with three
  sources, double-counting rules for OMP vs Claude Code vs limit cards, mixed-period rules, cost
  rules, deferred list, and never-commit list.
- `docs/release.md` — release process. 138 lines. Version source of truth (`package.json`),
  `scripts/bump-version.mjs` checking five files, CI workflows, artifact build matrix, recovery.
- `docs/data-shapes.md` — spike findings and scan records. 602 lines. OMP JSONL mapping, Gemini
  inside OMP, Antigravity live quota
  (`POST cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary`), Ollama Cloud usage
  (`GET ollama.com/api/usage`), Claude Code JSONL mapping, Cursor Pro payload and date-window
  finding, empty window 200 `{}`, re-run instructions.
- Fixtures under `docs/fixtures/`:
  - `docs/fixtures/omp-session-line.json` — redacted OMP assistant message line.
  - `docs/fixtures/omp-gemini-session-line.json` — real Gemini-via-Antigravity assistant line.
  - `docs/fixtures/cursor-cycle-aggregates.json` — rounded Cursor Pro cycle aggregate response.
  - `docs/fixtures/cursor-usage-summary.json` — Cursor plan and cycle boundary payload.
  - `docs/fixtures/cursor-window-aggregates.json` — Cursor windowed aggregate response.
  - `docs/fixtures/ollama-usage.json` — unauthenticated/redacted Ollama Cloud usage payload.
  - `docs/fixtures/antigravity-quota-summary.json` — Google Antigravity quota summary response.

Cross-references: `spec.md` points at product and data-shapes; `data-shapes.md` names fixtures
and planning docs; `release.md` documents workflows and bump tooling.

The numbered doc pairs (01–10) sit alongside the corpus: `docs/README.md` separates the input
planning documents from the pairs that document what exists.

## 3. Public surface

The product-facing surface of this area is the locked-decisions list, defined in
`docs/product.md` and restated in `docs/spec.md` (§ Locked decisions):

- **Sources** — OMP + Cursor + Claude Code. (Gemini through Antigravity arrives inside OMP as
  `source: "omp"`, provider `google-antigravity`; not a separate source).
- **Metric** — estimated pay-as-you-go cost from tokens × the local price DB. Never invoices,
  never Cursor's own cents.
- **OMP accounts** — no per-account split of usage or cost (two Claude Pro subscriptions + one
  Ollama Cloud key in this household); model-level breakdown is enough. Provider *limits* are the
  exception: shown per account, named by the email OMP recorded in `usage_history`, falling back
  to `Account A` / `Account B` when there is no email.
- **Claude Code** — third usage source. Reads transcripts under `~/.claude/projects/**/*.jsonl`
  (relocatable via `CLAUDE_CONFIG_DIR`, settings override `claude_path`). Timestamped lines, so
  calendar filters apply. Own subtotal and `(source, model)` rows under `source: "claude-code"`.
  Never deduped against OMP: tokens do not overlap, while subscriptions overlap on limit cards.
- **Cursor Pro** — per-model aggregates, never events. Calendar filters **apply**: dashboard API
  narrows aggregates with `startDate` / `endDate`, so Today / This month / Date range fetch their
  window. All time cannot be asked (refused by backend) and shows the billing cycle, labeled
  "Cycle to date". Empty window returns 200 `{}` and is treated as zero usage.
- **Cursor Enterprise** — optional `crsr_` admin key unlocks per-event timestamps and calendar
  filters. Not in this plan; the type union stays open.
- **Filters** — Today, This month (calendar month, not rolling 30 days), All time, Date range.
  Device local timezone. Inclusive end day in UI; exclusive next-midnight in code.
- **Combined total** — always shown, with per-source subtotals for switched-on sources (`omp`,
  `cursor`, `claude-code`). When Cursor answers for the window, all sources share the period and
  grand total is their sum (`mixedPeriod: false`). When Cursor cannot answer or fails, grand total
  is OMP + Claude Code (filtered) only; Cursor cycle is shown on its own row and excluded from
  the total (`mixedPeriod: true`). In all-time, Cursor cycle is included (`mixedPeriod: false`).
  No dedupe across sources.
- **By-model table** — rows keyed by `(source, model)`. Same model on multiple sources is
  separate rows.
- **Usage limits** — provider clocks, quoted: Claude 5-hour / 7-day per account from OMP
  `usage_history`, Ollama Cloud session / weekly from undocumented `GET ollama.com/api/usage`,
  Antigravity live quota from undocumented
  `POST cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary` via `agy`'s keychain
  session, Cursor included-pool percentages from `/api/usage-summary`. Never priced, never
  period-filtered, never summed. Ended window shows `—` / "window ended". A provider failure loses
  only its card, never failing the snapshot.
- **Projects route** — one card per working directory (`cwd` off OMP session header or Claude
  Code line) that burned tokens in the period, biggest spender first, with by-model breakdown.
  Headerless transcripts get "No project". Cursor is excluded (callout notes cycle has no folder).
- **Fetch** — on open + manual button. Keep previous data while fetching (spinner) and on error
  (banner + Retry). Status text "Fetched N min ago" (refreshed locally without refetching). No
  background timers.
- **Persistence** — SQLite at `~/.prompt-burn/db.sqlite`, outside install dirs so reinstalls keep
  data. Both desktop and VS Code shells share it.
- **Prices** — usage rows store tokens only; cost is computed at display time from `price_entries`
  with `effective_from` / `effective_until`. Retroactive pricing works without rewriting usage
  rows. Bundled rates for Claude, Ollama Cloud, Google Gemini (`gemini-3.8-flash`). Unknown models
  surface in Settings; unknown cost shows `—`, never `$0`.
- **Transcript cache** — incremental sync keyed on session-file mtime / offset in
  `omp_sync_state` (one table for both OMP and Claude Code, keyed by absolute path).
- **Settings keys** — `omp_enabled` / `omp_path`, `cursor_enabled`, `claude_enabled` /
  `claude_path`. Toggling a source off hides it from dashboard and skips sync, keeping stored rows.
- **VS Code** — full-width editor tab (`retainContextWhenHidden: true`), not a sidebar.
- **Release / version** — root `package.json` is sole version source of truth, stamped into five
  files via `scripts/bump-version.mjs`. GitHub Actions release workflow builds multi-OS binaries
  and `.vsix`.
- **Trust** — local only. Never persist Cursor auth tokens in DB; read from `state.vscdb` at fetch
  time.

The mixed-period contract is part of the public surface:
- When Cursor answered for the window: `mixedPeriod: false`, grand total sums all sources, hero
  subtitle names the period (e.g. `Estimated total · Today`).
- When Cursor could not answer: `mixedPeriod: true`, grand total covers OMP + Claude Code only,
  Cursor cycle total is shown on its own subtotal row (`Cursor (cycle to date · not in total)`),
  and hero subtitle states `OMP + Claude Code: Today · Cursor: cycle to date (not in total)`.
- All-time: `mixedPeriod: false`, Cursor cycle is counted in the total because scopes do not
  clash.
- Empty Cursor window: returns 200 `{}` and is treated as zero usage (not cycle fallback), so
  `mixedPeriod` remains false.

### Build-sequence status as of v1.1.0

All 10 plan PR batches and all 12 implementation phases have landed, plus follow-on features
and releases up through v1.1.0:

| Plan phase & commits | Scope and implementation state |
|----------------------|--------------------------------|
| Phase 0 (commits 1–3) | Foundation, docs, typecheck/test scripts — Landed. |
| Phase 1 (commits 4–7) | Core: types, period filter, aggregation — Landed. |
| Phase 2 (commits 8–9) | SQLite db, schema, prices — Landed via `node:sqlite`. |
| Phase 3 (commits 10–11) | Collectors: OMP JSONL parse, incremental sync — Landed. |
| Phase 4 (commits 12–15) | Desktop vertical slice: Tauri v2, Node sidecar — Landed. |
| Phase 5 (commits 16–21) | UI components on typed props: dashboard, settings — Landed. |
| Phase 6 (commits 22–24) | Cursor token, cycle aggregates, orchestrator — Landed. |
| Phase 7 (commits 25–27) | VS Code editor tab, extension host UsageReader — Landed. |
| Phase 8 (commits 28–30) | Settings writes, error banner, golden snapshots — Landed. |
| Phase 10 (commits 31–37) | Release automation: bump script, CI, release jobs — Landed. |
| Phase 11 (commits 38–39) | Provider limits: Claude, Ollama Cloud, Cursor — Landed. |
| Phase 12 (commit 40) | Cursor follows calendar: windowed aggregate fetch — Landed. |
| Post-plan: Projects | Projects route (`cwd`-based cards, biggest spender first) — Landed. |
| Post-plan: Claude Code | Third usage source (`~/.claude/projects`), settings — Landed. |
| Post-plan: Antigravity | Live Google Antigravity quota via `agy` keychain — Landed. |
| Post-plan: Releases | Shipped production releases v1.0.0 through v1.1.0 — Landed. |

Every phase of the planned implementation is complete; no planned work remains pending.

## 4. Flow

Reading order as the repo is consumed today:

1. `README.md` → `docs/product.md` (what) → `docs/release.md` (release).
2. `docs/spec.md` is opened separately at coding time as the implementer contract.
3. `docs/data-shapes.md` provides empirical payload schemas, field mappings, and scan notes.

Build flow encoded by the plan: The implementation sequence is fully realized. Phases 0–3
established the foundation, core domain, SQLite database, and OMP collector. Phase 4 delivered
the first runnable desktop slice. Phases 5–8 completed the UI on mocks, Cursor collector, VS Code
extension, and settings writes. Phase 10 landed release automation and CI. Phases 11–12 added
provider usage limits and Cursor calendar windowing. Follow-on commits added the Projects route,
Claude Code source, and Google Antigravity live quota collector.

Decision flow when the plan conflicts with reality:
1. Empirical finding observed and recorded in `docs/data-shapes.md`.
2. Planning docs (`product.md`, `spec.md`) updated in tandem.
3. Implementation and regression tests updated to reflect the locked decision.

## 5. Contracts and invariants

- The locked table is restated across `product.md` and `spec.md`. `product.md` is the tiebreaker
  on any conflict.
- Multi-source totals are additive across OMP, Claude Code, and Cursor. No deduplication is
  performed across sources: different transcript trees represent independent work.
- Claude Code and OMP are strictly disjoint transcript streams. Their usage and costs never
  overlap. Their shared subscription appears exclusively on the Usage limits panel.
- Mixed-period arithmetic: `DashboardSnapshot.mixedPeriod` indicates a Cursor cycle standing
  against a narrower period. `estimatedCents` excludes Cursor whenever `mixedPeriod` is true.
  In all-time, `mixedPeriod` is false and Cursor is included.
- Empty Cursor windows answer `200 {}` and represent zero usage for the period, keeping
  `mixedPeriod` false.
- Cost display: unknown model rate produces `estimatedCents: null`, rendered as `—`, never `$0`.
  The hero card displays `≈$X` plus an unpriced model count chip when partial rates are present.
- Retroactive pricing: inserting a rate in `price_entries` recalculates historical costs on the
  next snapshot without mutating stored usage records.
- Secrets invariant: Never commit Cursor access tokens, `crsr_` keys, Antigravity OAuth tokens,
  raw session transcripts, real home paths, or `.env`.

## 6. Configuration

Runtime configuration and workspace tooling:

- Database location: `~/.prompt-burn/db.sqlite`, outside install directories.
- Settings table (`settings`):
  - `omp_enabled` (boolean) / `omp_path` (string override; empty = default)
  - `cursor_enabled` (boolean)
  - `claude_enabled` (boolean) / `claude_path` (string override; empty = default)
- Environment variables:
  - `CLAUDE_CONFIG_DIR`: relocates Claude Code projects directory (`<CLAUDE_CONFIG_DIR>/projects`).
  - Node version: `>=24` required (`engines` in `package.json`, `.nvmrc`).
- Root workspace scripts:
  - `pnpm dev`: launches Tauri desktop development environment.
  - `pnpm typecheck`: typechecks root and all workspace packages
    (`tsc -p . && pnpm -r --if-present typecheck`).
  - `pnpm test`: runs unit and integration test suites
    (`node --test scripts/*.test.mjs && pnpm -r --if-present test`).
  - `pnpm bump <patch|minor|major|version>`: executes version bump across five manifest files.
  - `pnpm version:check`: validates version synchronization without writing changes.
- Spike script: `node scripts/spike/dump-shapes.mjs [out/]`.

## 7. Boundaries and dependencies

- Seven workspace members:
  - `packages/core` — domain types, period filters, model ID normalization, snapshot aggregation.
  - `packages/db` — SQLite schema, settings repository, price resolution, event queries.
  - `packages/collectors` — transcript parsers (OMP, Claude Code), Cursor auth/aggregate fetcher,
    Ollama Cloud usage client, Antigravity quota client.
  - `packages/reader` — `UsageReader` implementation orchestrating multi-source collection,
    window caching, limits consolidation.
  - `packages/ui` — props-only React + Tailwind dashboard components; no filesystem or network I/O.
  - `apps/desktop` — Tauri v2 application with bundled Node sidecar (`sidecar.mjs`).
  - `apps/vscode` — VS Code extension hosting custom editor tab webview.
- **Deliberate divergence from plan:** The original plan sketched `better-sqlite3`. The shipped
  code uses Node 24's built-in `node:sqlite` (`DatabaseSync`) across `packages/db` and
  `packages/collectors` (reading Cursor's `state.vscdb`). The repository has zero third-party
  SQLite dependencies.
- **Schema bundling:** `schema.ts` inlines SQL text rather than reading `schema.sql`, allowing
  single-file bundles (`sidecar.mjs`, `out/extension.js`) to initialize the database.
- **CI and release automation:** GitHub Actions workflows (`ci.yml`, `release.yml`) automate
  testing and multiplatform releases. Shipped desktop installers are unsigned.

## 8. Tests

Shipped test coverage:

- `packages/core`: calendar period boundary calculations, timezone conversions, model ID
  normalization (including Anthropic dated snapshot stripping), snapshot aggregation, mixed-period
  arithmetic.
- `packages/db`: schema creation, settings read/write and default fallbacks, point-in-time price
  resolution with `effective_from` / `effective_until`, retroactive pricing, event queries.
- `packages/collectors`: OMP JSONL parsing, recursive subagent transcript discovery, incremental
  sync state handling, Claude Code JSONL parsing and stable event ID generation, Cursor auth
  retrieval from `state.vscdb`, Cursor aggregate parsing and empty window handling, Ollama Cloud
  usage parsing, Antigravity quota retrieval and keychain OAuth client extraction.
- `packages/reader`: `UsageReader` lifecycle, multi-source collection orchestration, window
  memoization and fallback, limits consolidation, golden integration snapshots.
- `packages/ui`: rendering of AppShell, Dashboard, Projects route, Settings screen, UsageLimits
  panel, PeriodBar, ModelTable, CursorCycle, FetchBanner, formatters, edge states.
- `apps/desktop`: web UI rendering and sidecar integration tests.
- `apps/vscode`: extension host messaging, custom editor provider, webview host communications.
- `scripts`: `bump-version.test.mjs` verifying version consistency across five files.

What is NOT covered mechanically:

- Consistency between the two planning copies (`product.md` and `spec.md`).
- Upstream stability of undocumented endpoints (`ollama.com/api/usage` and Google's
  `retrieveUserQuotaSummary`).
- Verification of Claude Code transcript shapes against a local machine fixture (derived from
  specs and code, no local transcript exists on this machine yet).
- Desktop application code signing and notarization (macOS quarantine flags, Windows SmartScreen).

## 9. Debt and traps

- **Two copies of the locked table will drift.** `product.md` and `spec.md` duplicate the
  locked decisions with no mechanical check. A change must be hand-edited into both.
- **`spec.md` is an orphan link-wise.** Nothing links to it from `README.md`; it is discoverable
  only by habit or deep reference traversal.
- **Claude Code mapping is unspiked on this machine.** The collector was implemented from
  specifications and code rather than an empirical transcript file from this machine.
- **Two provider limit endpoints are undocumented and brittle.** Ollama's `/api/usage` and
  Google's `retrieveUserQuotaSummary` are private APIs. Upstream changes will break limit cards
  without warning (though designs drop the card without failing the fetch).
- **Google Antigravity OAuth client extraction is fragile.** Client credentials must be extracted
  at runtime from `~/.gemini/bin/agy`, requiring trial against Google's OAuth endpoint, a strict
  `antigravity` User-Agent, and omitting `x-goog-user-project`.
- **Cursor all-time window is permanently unaskable.** Cursor's backend refuses unbounded
  queries crossing internal historical dates, requiring all-time to remain cycle-to-date.
- **Desktop releases are unsigned.** Unsigned macOS `.dmg` requires
  `xattr -dr com.apple.quarantine`, and Windows installers trigger SmartScreen warnings.
- **Antigravity CLI standalone turns are missing from cost.** Turns executed in the standalone
  `agy` CLI live in `~/.gemini/antigravity-cli/conversations/*.db` and are not ingested into
  `usage_events`. Its quota card reflects spend absent from the cost dashboard.
- **Mixed-period UI and arithmetic logic is a permanent constraint.** Whenever Cursor falls back
  to cycle totals for a narrower period, the UI must display separate scopes and arithmetic must
  exclude Cursor from `estimatedCents`.

## 10. Change guide

- Adding or modifying a product decision: Edit the table in `docs/product.md` first (authority),
  then mirror in `docs/spec.md`. Re-run or create spike tests if data schemas change.
- Adding a usage source or provider limit:
  - For usage: update `Source` in `packages/core`, adjust `usage_events` CHECK constraint in
    `packages/db`, implement parser in `packages/collectors`, integrate in `packages/reader`, add
    subtotal and settings toggle in `packages/ui`.
  - For limits: implement limit fetcher in `packages/collectors`, wire into `createUsageReader`,
    ensure failure drops only the individual card.
- Changing Cursor windowing or period logic: Modify `periodBounds` in `packages/core` and
  `fetchCursorWindowAggregate` in `packages/collectors`. Ensure `mixedPeriod` flag, hero subtitle,
  cycle footnote, and golden snapshots move together.
- Cutting a release: Run `pnpm bump <patch|minor|major>` to update the five version files, ensure
  CI is green, and trigger `release.yml` via GitHub Actions `workflow_dispatch`.
- Adding or updating prices: Insert into `packages/db` bundled rates, or enter via Settings UI.
  Historical events are retroactively re-priced on the next snapshot.
