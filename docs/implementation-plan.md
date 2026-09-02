# Prompt Burn — implementation plan

Greenfield. Split into small, reviewable commits. Each commit is one concern, should typecheck, and should be reviewable in about 10 minutes.

Product decisions live in [product.md](product.md). This file is the build sequence. Older wireframes that include Projects, quota tiles, or a source dropdown are out of date.

---

## Locked product decisions

| Decision | What it means |
|----------|----------------|
| Sources | OMP + Cursor only |
| Metric | Estimated PAYG cost from tokens × our price DB. Not subscription invoices. |
| OMP accounts | Do not split Claude Pro / Ollama Cloud by account. Model-level breakdown is enough. |
| Cursor Pro | Cycle-to-date per-model aggregates. Calendar filters do **not** apply. Label **“Cycle to date”**. |
| Cursor Enterprise | Optional `crsr_` admin key unlocks per-event timestamps and calendar filters. **Not in this plan** — leave the type union open; implement when a key exists. |
| Filters | Today, This month (calendar month, not rolling 30 days), All time, Date range (single day = same start and end). Device timezone. Inclusive end day in UI; exclusive next-day 00:00 in code. |
| Combined total | Always shown. Per-source subtotals always shown. No dedupe across OMP + Cursor. |
| By-model table | Rows keyed by `(source, model)`. Same model on both sources = two rows. |
| Fetch | On open + manual button. No background timers. Spinner while fetching; **keep previous data**. Relative “Fetched N min ago”. On error: keep old data + banner. |
| Persistence | SQLite at `~/.prompt-burn/db.sqlite`. Outside install dirs so updates/reinstalls keep data. |
| Prices | Usage stores tokens only. Cost is derived from `price_entries` with `effective_from` / `effective_until`. Adding a price retroactively prices old events. Ship bundled Claude + Ollama Cloud rates. Unknown models surface in Settings. |
| OMP cache | Incremental sync keyed on session-file mtime / offset. |
| VS Code | Opens as an **editor tab** (full width), not a sidebar. |
| Trust | Local only. Never persist Cursor auth tokens in our DB. |

### Combined total when periods differ

Cursor Pro is always cycle-to-date. When the user picks Today / This month / Date range:

- OMP total = filtered
- Cursor total = cycle-to-date (unchanged)
- Grand total = OMP(filtered) + Cursor(cycle)
- Hero subtitle must say so, e.g. `OMP: Today · Cursor: cycle to date`

Never invent daily splits from cycle aggregates.

---

## Architecture

```
packages/
  core/          types, period filter, aggregation, price resolution
  db/            schema.sql, path helper, repositories (better-sqlite3)
  collectors/    OMP JSONL + Cursor Pro cycle fetch (Node I/O)
  ui/            React + Tailwind — props only, no fs/network
apps/
  desktop/       Tauri v2 + Node sidecar
  vscode/        Extension host + custom editor webview
```

**UI never imports collectors.** Both shells implement `UsageReader` and call `core`.

```ts
interface UsageReader {
  discover(): Promise<ReaderHealth[]>;
  fetch(): Promise<FetchResult>;
  getSnapshot(period: PeriodFilter): Promise<DashboardSnapshot>;
}
```

Desktop and VS Code share `packages/db` and `packages/collectors` verbatim. The Tauri webview talks to a **Node sidecar**; the VS Code webview talks to the extension host. Same TypeScript, two thin hosts.

### Why a Node sidecar (not rusqlite)

One SQLite layer and one Cursor HTTP client. Rust collectors would duplicate both. `sql.js` is rejected for `state.vscdb` — that file can be large; use `better-sqlite3` read-only, keyed lookups only.

Until a schema change ships to a second user, **no migration runner**. Open → execute `schema.sql` if the file is new. Deleting `~/.prompt-burn/db.sqlite` is the reset path.

---

## Package layout (create as you go)

Do not scaffold empty packages in the first commit. Add a package when its first real commit lands.

```
prompt-burn/
  package.json              pnpm workspaces
  tsconfig.base.json
  docs/implementation-plan.md
  packages/core/
  packages/db/
  packages/collectors/
  packages/ui/
  apps/desktop/
  apps/vscode/
```

---

## Domain types (commit 4)

```ts
type Source = "omp" | "cursor";

interface UsageEvent {
  id: string;
  source: Source;
  timestamp: string; // ISO
  model: string;     // canonical after alias map
  rawModel: string;
  tokens: { input: number; output: number; cacheRead?: number; cacheWrite?: number };
  sessionId?: string;
}

type PeriodFilter =
  | { kind: "today" }
  | { kind: "this_month" }
  | { kind: "all_time" }
  | { kind: "range"; start: string; end: string }; // ISO dates, local tz, inclusive end

type CursorSnapshot =
  | {
      mode: "cycle_aggregate";
      cycleStart: string;
      cycleEnd: string;
      models: ModelAggregate[];
    }
  | {
      mode: "events";
      events: UsageEvent[];
    };

interface DashboardSnapshot {
  period: PeriodFilter;
  estimatedCents: number | null; // null if any included row has unknown price
  omp: SourceTotals;
  cursor: SourceTotals & { mode: CursorSnapshot["mode"]; cycleLabel?: string };
  models: Array<ModelAggregate & { source: Source; estimatedCents: number | null }>;
  mixedPeriod: boolean; // true when Cursor is cycle-only and period is not all-time-equivalent
  fetch: { lastSuccessAt: string | null; status: "idle" | "fetching" | "error"; error?: string };
}

interface FetchState {
  status: "idle" | "fetching" | "error";
  lastSuccessAt: Date | null;
  error?: string;
}
```

Store Cursor cycle aggregates as synthetic rows with `period = 'cycle'` and **no fake timestamps**.

---

## Schema (`schema.sql`)

```
usage_events
  id, source, timestamp, model, raw_model, input, output, cache_read, cache_write, session_id
  -- no cost column

price_entries
  id, model, provider, effective_from, effective_until,
  input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok

omp_sync_state
  path, mtime, offset

settings
  key, value   -- omp path, cursor enabled, last_success_at, last_error, …

-- no model_aliases table: alias map lives in core code
-- no fetch_metadata table: last_success_at is a settings row
```

Price resolution: for each event, pick the `price_entries` row where `effective_from <= timestamp` and (`effective_until` is null or `> timestamp`). Unknown model → `estimatedCents = null`, UI shows `—`.

---

## Commits

Each commit: one concern, green types/tests, under ~300 lines when possible.

### Phase 0 — Foundation

| # | Commit | What lands | Review focus |
|---|--------|------------|--------------|
| 1 | `chore: scaffold pnpm workspace and shared tsconfig` | Root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`. No empty packages. | Tooling only |
| 2 | `docs: record product spec and data-shape notes` | Short `docs/spec.md` of the locked table above. Spike notes: dump one real OMP JSONL line and one Cursor `GetAggregatedUsageEvents` response (redact tokens). | Confirms token fields before types freeze |
| 3 | `chore: add typecheck and test scripts` | Root `pnpm test` / `pnpm typecheck`. CI later if wanted; a local script is enough at first. | Empty workspace still passes |

**Spike is blocking.** Do not start commit 4 until the OMP line and Cursor payload are on disk as fixtures. If Cursor Pro returns no per-model tokens, stop and revisit — the dashboard is built around those fields.

### Phase 1 — Core

| # | Commit | What lands | Review focus |
|---|--------|------------|--------------|
| 4 | `feat(core): add domain types and DashboardSnapshot` | Types above, including the view model UI will mock. | View model is the contract |
| 5 | `feat(core): filter events by calendar period` | Device timezone. Inclusive end → exclusive next local midnight. | Tests: IST month boundary, single-day range, Jan 1 |
| 6 | `feat(core): normalize model ids` | In-code map Cursor `modelIntent` → canonical id. | Pure function + tests. No DB table. |
| 7 | `feat(core): aggregate totals and by-model rows` | Combined + per-source. `(source, model)` rows. `mixedPeriod` flag. | Test: OMP today + Cursor cycle unchanged |

### Phase 2 — Database

| # | Commit | What lands | Review focus |
|---|--------|------------|--------------|
| 8 | `feat(db): create sqlite at ~/.prompt-burn and apply schema.sql` | Path helper, open-or-create, seed bundled Claude + Ollama Cloud rates. | File lives outside the app dir |
| 9 | `feat(db): resolve price for an event timestamp` | Join + unknown → null. Retroactive: insert a price, old events pick it up with no row rewrite. | Tests with `effective_from` ranges |

### Phase 3 — OMP collector

| # | Commit | What lands | Review focus |
|---|--------|------------|--------------|
| 10 | `feat(collectors): parse OMP session JSONL` | Tokens, timestamp, model from `~/.omp/agent/sessions/`. | Fixture from the spike |
| 11 | `feat(collectors): incremental OMP sync into usage_events` | `omp_sync_state` mtime/offset. Dedupe by stable id (or hash of file+line+timestamp+model+tokens). | Second fetch skips unchanged files |

### Phase 4 — Desktop vertical slice

First runnable app. OMP only. No period filter, no Settings, no Cursor. One number on screen.

| # | Commit | What lands | Review focus |
|---|--------|------------|--------------|
| 12 | `feat(desktop): scaffold Tauri v2 with Node sidecar` | Window + sidecar process. Sidecar can open the DB. | Sidecar decision is now real, not theoretical |
| 13 | `feat(desktop): implement UsageReader on the sidecar` | `fetch()` runs OMP sync. `getSnapshot(all_time)` uses core aggregate. | Same interface VS Code will implement |
| 14 | `feat(ui): render estimated total from a snapshot prop` | Minimal React surface: one total, “Fetch data”, last-fetched label. | No fs imports in ui |
| 15 | `feat(desktop): fetch on open and keep stale data while fetching` | Wire the control. Spinner; do not blank the number. | End-to-end OMP path |

After commit 15 you can use the app. Remaining work adds Cursor and the real UI around a known-good pipe.

### Phase 5 — UI

Build against **typed** `DashboardSnapshot` mocks (instances of commit 4), not ad-hoc shapes.

| # | Commit | What lands | Review focus |
|---|--------|------------|--------------|
| 16 | `feat(ui): add shell, nav, and design tokens` | Dashboard · Settings. Amber actions, teal OMP, violet Cursor. Trust line. | Layout only |
| 17 | `feat(ui): add period filter and date range picker` | One control for single day and range. Chip shows the selected dates. | Matches unified picker |
| 18 | `feat(ui): add hero totals card` | Combined + OMP/Cursor subtotals. Mixed-period subtitle. | Copy when scopes differ |
| 19 | `feat(ui): add by-model table` | Source pills. Unknown price `—`. | Per `(source, model)` |
| 20 | `feat(ui): add cycle banner and empty states` | Cycle dates. Not-fetched-yet. Zero usage. Fetching with data still visible. | Wireframe edge states |
| 21 | `feat(ui): add settings screen` | OMP/Cursor toggles + paths. Unknown-model list. Display only — writes land in commit 28. | No Projects, no quota |

### Phase 6 — Cursor + orchestrator

| # | Commit | What lands | Review focus |
|---|--------|------------|--------------|
| 22 | `feat(collectors): read Cursor access token from state.vscdb` | Key-only SQLite read. Not installed / missing key / expired. | Never copy the token into our DB |
| 23 | `feat(collectors): fetch Cursor Pro cycle aggregates` | `GetAggregatedUsageEvents` → `CursorSnapshot` cycle mode. | Fixture from the spike |
| 24 | `feat(collectors): orchestrate OMP + Cursor fetch` | Parallel. Per-source OK / error. Partial success is valid. | Snapshot builder uses both |

### Phase 7 — VS Code

| # | Commit | What lands | Review focus |
|---|--------|------------|--------------|
| 25 | `feat(vscode): custom editor provider` | Command opens a Prompt Burn tab. `retainContextWhenHidden: true`. | Editor area, not sidebar |
| 26 | `feat(vscode): implement UsageReader in the extension host` | Reuse `packages/collectors` + `packages/db`. | No duplicated I/O |
| 27 | `feat(vscode): host ui bundle in the webview` | `postMessage` snapshot + fetch commands. Same React bundle as desktop. | No second UI |

### Phase 8 — Settings writes and hardening

| # | Commit | What lands | Review focus |
|---|--------|------------|--------------|
| 28 | `feat(settings): save paths, toggles, and unknown-model prices` | Insert `price_entries` → next snapshot recalculates. Persist in the same DB. | Retroactive pricing |
| 29 | `feat(ui): show fetch error banner without clearing data` | “Cursor failed · OMP OK” + Retry. | Partial success |
| 30 | `test: add golden snapshots for OMP and Cursor aggregation` | Fixtures from the spike → expected `DashboardSnapshot`. | Regression lock |

---

## PR grouping

| PR | Commits | Delivers |
|----|---------|----------|
| 1 Foundation | 1–3 | Repo, spec, spike fixtures |
| 2 Core + DB | 4–9 | Business logic, no UI |
| 3 OMP + desktop slice | 10–15 | Usable Tauri app (OMP only) |
| 4 UI | 16–21 | Full dashboard on mocks |
| 5 Cursor | 22–24 | Both sources |
| 6 VS Code | 25–27 | Extension tab |
| 7 Polish | 28–30 | Settings writes, errors, goldens |

---

## Explicitly deferred

Do not implement until asked:

- Cursor Enterprise `crsr_` event ingest (type union already allows it)
- Schema migration runner
- `model_aliases` table (code map is enough)
- Projects view
- Quota / subscription tiles
- Source dropdown (OMP only / Cursor only)
- Auto-refresh
- OpenCode, Claude Code, OpenRouter
- Export CSV/JSON
- Per-account OMP breakdown
- Timezone setting (device tz only)

---

## Commit rules

- One concern: schema **or** parser **or** one UI piece — not both.
- DB commit lands before the UI/collector that reads it.
- Do not commit Cursor tokens, OMP session contents with usernames, or `.env` files. Spike fixtures must be redacted.
- If a commit needs both a schema change and UI, split it.

---

## First milestone

After **commit 15**: open the Tauri app, fetch OMP, see an estimated total, refresh without blanking.

After **commit 24**: both sources, real filters, mixed-period labeling.

After **commit 27**: same UI in a VS Code editor tab, same `~/.prompt-burn/db.sqlite`.
