# Prompt Burn — product document

Local dashboard for AI coding token usage. It answers: **if this usage had been billed at public pay-as-you-go rates, what would it have cost?**

This is a personal tool. Dollar labels are for the owner's own comparison, not invoices. Nothing leaves the machine.

**Related docs:** [implementation plan](implementation-plan.md) (how to build). Wireframes live in Paper (`prompt-burn` / `v0-wireframes`).

---

## Problem

Coding assistants (OMP, Cursor) hide how much token work actually happens behind a subscription. There is no single local view of:

- How many tokens each model used
- What that would have cost at public API rates
- How that usage sits against Cursor's billing-cycle aggregates

Prompt Burn is that view. It is not a billing product, not a quota meter, and not a replacement for Cursor's spending dashboard.

---

## Audience and surfaces

- **Audience:** one person on one machine (the author), using OMP and Cursor.
- **Desktop:** Tauri v2 app (React + Tailwind).
- **VS Code:** same UI in an **editor tab** (full editor width, not a sidebar). Command opens a tab titled Prompt Burn, like opening a file.
- **No web app, no account, no cloud.**

---

## What it tracks

Two sources only.

| Source | What we read | Time grain | Cost |
|--------|----------------|------------|------|
| **OMP** (Oh My Pi) | Session logs under `~/.omp/agent/sessions/` | Per-event timestamps | Tokens × our price DB |
| **Cursor (Pro, default)** | Dashboard API cycle aggregates (`GetAggregatedUsageEvents`), auth from local `state.vscdb` | **Billing cycle only** — labeled **“Cycle to date”** | Same price DB |
| **Cursor (Enterprise, optional)** | Admin API usage events with a `crsr_` key | Per-event timestamps → calendar filters work | Same price DB |

OMP usage in this household: two Claude Pro subscriptions and one Ollama Cloud API key. **Do not split by account.** Model-level breakdown is enough.

Cursor **subscription remaining / plan % / quota tiles are out of scope.** Only model usage → estimated cost.

---

## Metrics (do not mix)

| Metric | Meaning |
|--------|---------|
| **Estimated cost** | Tokens × versioned public rates in the local price DB. One number internally; the UI label can be informal. |
| **Tokens** | Input, output, cache read, cache write when the source provides them. |

Never show Cursor included-pool % or “$X of $20 plan used.” Never treat Cursor dashboard cents as the product’s source of truth unless we later choose them as a cross-check.

**Combined total:** OMP (filtered) + Cursor (cycle or filtered). **No dedupe** across sources. Same work in both tools can inflate the grand total; that is accepted.

**By-model table:** rows keyed by `(source, model)`. Same model on OMP and Cursor = two rows.

---

## Filtering

Device **local timezone**. No timezone setting.

| Control | Rule |
|---------|------|
| **Today** | Local midnight → next local midnight |
| **This month** | Calendar month (1st 00:00 → first moment of next month). **Not** rolling 30 days. |
| **All time** | No date bound on stored events |
| **Date range** | Inclusive start and inclusive end in the UI. In code: `timestamp >= start 00:00` and `timestamp < dayAfterEnd 00:00`. Same start and end date = one day. |

### Cursor vs calendar filters

| Cursor mode | Today / This month / Date range / All time |
|-------------|--------------------------------------------|
| **Pro (no admin key)** | **Do not apply.** Cursor stays **cycle to date**. Period filters apply to **OMP only**. |
| **Enterprise + `crsr_` key** | Cursor events participate in the same period as OMP. |

When scopes differ, the hero **must** say so, e.g.:

`Estimated total · OMP: Today · Cursor: cycle to date`

Never invent daily splits from cycle aggregates. Store cycle rows with `period = 'cycle'` and no fake timestamps.

**All time (Pro):** OMP = every stored event. Cursor = current billing cycle only. Label that, or keep the cycle footnote visible.

---

## Fetch

- Fetch **once on open**, then only when the user clicks **Fetch data**.
- **No auto-refresh, no background polling.**
- While fetching: small spinner + “Fetching…”. **Keep showing the last snapshot.** No skeletons, no blanking to `$0`.
- After success: replace data, set `lastSuccessAt`.
- After error: keep old data + banner (e.g. Cursor failed, OMP OK) + Retry.
- Status text: `Fetched 3 min ago` (refresh the relative string locally about once a minute **without** refetching).
- First install: `Not fetched yet` until a successful fetch.

OMP fetch is **incremental**: remember each session file’s mtime / offset; skip unchanged files. First fetch may scan everything; later fetches should be cheap.

---

## Persistence

| Item | Location |
|------|----------|
| App DB | `~/.prompt-burn/db.sqlite` |
| Bundled prices | Seeded into that DB |

Path is **outside** install directories so app updates, extension updates, and reinstalls keep data. Desktop and VS Code **share the same file**.

**Do not** store Cursor access tokens in this DB. Read them from Cursor’s `state.vscdb` at fetch time.

Usage rows store **tokens and timestamps, not cost.** Cost is computed at display/aggregate time from `price_entries`.

---

## Pricing

- Ship **bundled rates** for common Claude models and Ollama Cloud models.
- Each price row has `effective_from` / `effective_until`. Resolution: the row valid at the event’s timestamp.
- **Unknown models** appear in Settings with `Add price`. Inserting a row **retroactively prices old events** (no rewrite of usage rows). Changing a historical rate = new row with a new `effective_from`; old events keep the rate that was valid at their time.
- Unknown cost in the table: show `—`, not `$0`.

---

## Screens

Two routes. **No Projects view. No onboarding.** Open → Dashboard.

### Dashboard

1. **Chrome:** Prompt Burn · Dashboard / Settings · Fetch data · fetch status · trust line *Local only · nothing leaves this device*
2. **Period bar:** Today · This month · All time · Date range
3. **Mixed-scope footnote** when Cursor is Pro (violet-leaning callout): cycle dates + “period filters apply to OMP only”
4. **Hero:** combined estimated cost, OMP subtotal, Cursor subtotal (with cycle label if Pro), token breakdown
5. **By-model table:** Model, Source (OMP / Cursor), tokens, estimated cost
6. **Cursor cycle card** (Pro): cycle window, tokens + cost for the cycle, note that per-day filtering needs an Enterprise key

### Settings

- **OMP:** on/off, path override (default `~/.omp/agent/sessions/`), health
- **Cursor:** on/off, Pro vs Enterprise status
- **Optional `crsr_` key:** unlocks event-level Cursor + calendar filters (type exists; ingest can land later)
- **Pricing table:** bundled rates + **unknown models** to price
- **About:** `~/.prompt-burn/db.sqlite` persists across reinstalls

### VS Code

Same Dashboard and Settings inside an **editor tab** (`retainContextWhenHidden: true`). Design for a wide editor column, not a 350px sidebar.

---

## Architecture (product-level)

```
packages/core          types, period filter, aggregation, price resolution
packages/db            SQLite schema, path, repositories
packages/collectors    OMP JSONL + Cursor fetch (Node)
packages/ui            React + Tailwind — props only, no fs/network
apps/desktop           Tauri v2 + Node sidecar
apps/vscode            Extension host + custom editor webview
```

**UI never talks to disk or APIs.** Both shells implement a reader (`discover` / `fetch` / `getSnapshot`) and pass a snapshot into the same UI.

Desktop and VS Code share DB + collectors. The Tauri webview talks to a Node sidecar; the VS Code webview talks to the extension host via `postMessage`.

---

## Trust

- Local reads only: OMP session logs, Cursor local state, Cursor APIs from this machine.
- No upload, no telemetry, no account.
- Trust copy is always visible.
- Spike fixtures and commits must not contain live tokens or identifiable session paths.

---

## Out of scope

Until explicitly asked:

- Projects / git-root grouping
- Quota or subscription remaining
- Source dropdown (OMP only / Cursor only)
- Auto-refresh
- Per-account OMP split
- Timezone picker
- OpenCode, Claude Code, OpenRouter, Codex, Copilot
- Export CSV/JSON
- Cloud sync, team features
- Onboarding wizard
- Schema migration runner (delete the DB file to reset, until a second user exists)
- Recreating Cursor daily usage from cycle totals

---

## Edge cases the UI must show

| State | What the user sees |
|-------|---------------------|
| Never fetched | Empty / `$0` or em dash, **Fetch data**, `Not fetched yet` |
| Fetched, zero usage for period | `$0.00`, “No OMP or Cursor usage for this period” |
| Fetching | Spinner; **previous numbers stay** |
| Partial failure | Banner naming which source failed; remaining data stays |
| Unknown model price | `—` in cost cell; Settings lists the model |
| Cursor not installed / no token | Cursor section degraded; OMP still works |
| Mixed period (Pro + Today) | Hero subtitle names both scopes; Cursor numbers do not shrink to “today” |

---

## Success

The product is doing its job when, on one machine:

1. Opening the desktop app or the VS Code tab fetches once and shows estimated cost plus tokens.
2. Clicking Fetch updates numbers without the screen going blank.
3. Today / this month / date range change **OMP** correctly in local timezone; Cursor Pro stays cycle-to-date and is labeled as such.
4. Adding a missing model price in Settings changes historical estimated cost on the next snapshot.
5. Reinstalling the app or extension still uses `~/.prompt-burn/db.sqlite`.
