# Data-shape spike — OMP and Cursor Pro

Spiked on this machine (macOS, 2026-09-02) before freezing `packages/core` types in commit 4.
Fixtures: [`fixtures/omp-session-line.json`](fixtures/omp-session-line.json),
[`fixtures/omp-gemini-session-line.json`](fixtures/omp-gemini-session-line.json),
[`fixtures/cursor-cycle-aggregates.json`](fixtures/cursor-cycle-aggregates.json),
[`fixtures/cursor-usage-summary.json`](fixtures/cursor-usage-summary.json).
A second OMP scan on 2026-09-04 added Gemini through Antigravity — see
[Gemini through Antigravity](#gemini-through-antigravity--second-scan-2026-09-04).

**Headline answer: yes — Cursor Pro returns per-model input / output / cache tokens on this
account.** The dashboard's core assumption holds. One locked decision is wrong, though: see
[Finding: Cursor Pro *does* accept date windows](#finding-cursor-pro-does-accept-date-windows).

---

## OMP

Source: `~/.omp/agent/sessions/<slugified-cwd>/<timestamp>_<uuid>.jsonl`, one JSON object per
line. Subagent transcripts live one level deeper, in a directory named after the parent session
file (`…/<timestamp>_<uuid>/Commit-5.jsonl`), and carry their own usage. **Globbing must be
recursive** or every subagent's tokens are silently dropped.

Two line types matter. A `type: "session"` header, first-ish in each file:

```json
{
  "type": "session",
  "version": 3,
  "id": "01a06111-2b47-75b9-9bd1-acfc5358378f",
  "timestamp": "2026-09-02T07:41:50.279Z",
  "cwd": "/Users/example/project",
  "title": "Commit changes",
  "titleSource": "auto"
}
```

…and `type: "message"` lines, where `message.role === "assistant"` carries `message.usage`.
User messages, `custom`, `title_change`, `service_tier_change`, `credential_pin` have no usage.

### `UsageEvent` mapping

| Our field | OMP source | Example |
|-----------|------------|---------|
| `id` | `` `omp:${session.id}:${line.id}` `` — `line.id` is 8 hex chars, unique per file only | `omp:01a06111-…:566d37c8` |
| `source` | constant | `"omp"` |
| `timestamp` | `line.timestamp` (ISO 8601, UTC, top level) | `"2026-09-02T08:31:31.505Z"` |
| `rawModel` | `line.message.model` — **no provider prefix** | `"claude-opus-5"`, `"glm-5.3-flash"`, `"gemini-3.8-flash"` |
| `model` | canonical id after the commit-6 alias map | `"claude-opus-5"` |
| `tokens.input` | `line.message.usage.input` | `2` |
| `tokens.output` | `line.message.usage.output` | `105` |
| `tokens.cacheRead` | `line.message.usage.cacheRead` | `37378` |
| `tokens.cacheWrite` | `line.message.usage.cacheWrite` | `463` |
| `sessionId` | `id` from the file's `type: "session"` line | `01a06111-…` |

Numbers are JSON numbers, always present on assistant messages (`0`, not absent, when unused).

Also on the line, deliberately unused:

- `message.usage.cost` — OMP's own dollar estimate (`input`/`output`/`cacheRead`/`cacheWrite`/`total`, USD floats). We recompute from `price_entries`; storing it would fight retroactive repricing. Useful as a cross-check in a spike, not in the DB.
- `message.usage.totalTokens` — derivable sum.
- `message.usage.cttl.ephemeral5m` — cache TTL bucket, already counted in `cacheWrite`.
- `message.provider` / `message.api` — `"anthropic"` / `"ollama-cloud"` / `"google-antigravity"`, `"anthropic-messages"` / `"ollama-chat"` / `"google-gemini-cli"`. Useful for the alias map's provider column and for choosing bundled rates.
- `message.contextSnapshot.promptTokens` — context-window gauge, **not** billable input.

### Gemini through Antigravity — second scan, 2026-09-04

A full scan of assistant lines in the same directory, after Gemini work moved into OMP. Every
distinct `(message.model, message.provider, message.api)` triple:

| `message.model` | `message.provider` | `message.api` |
|-----------------|--------------------|---------------|
| `claude-opus-5` | `anthropic` | `anthropic-messages` |
| `claude-haiku-4-5` | `anthropic` | `anthropic-messages` |
| `glm-5.3` | `ollama-cloud` | `ollama-chat` |
| `glm-5.3-flash` | `ollama-cloud` | `ollama-chat` |
| `kimi-k2.7-code` | `ollama-cloud` | `ollama-chat` |
| **`gemini-3.8-flash`** | **`google-antigravity`** | **`google-gemini-cli`** |

`gemini-3.8-flash` on 374 assistant lines is the **only** Gemini triple observed. No other
Gemini id appears; do not add ids nobody has seen.

**Still `source: "omp"`.** Antigravity is a value of `message.provider` — the same slot
`anthropic` and `ollama-cloud` occupy — not a Prompt Burn origin. The lines sit in OMP
transcripts, arrive through the OMP parser, and dedupe on the OMP key. Sources stay OMP +
Cursor; a third origin would double-count the same files.

`canonicalModelId` passes `gemini-3.8-flash` through unchanged, and the bundled rates now carry
it: Google's standard paid-tier Gemini API rates, $0.75 input / $3.75 output (thinking included)
/ $0.075 context caching per Mtok, provider `google-antigravity`, backdated with
`SEED_EFFECTIVE_FROM` like every other bundled row. Those are the intro rates published through
2026-12-31; the 2027-01-01 doubling is a close-and-insert, never an edit. Cache **write** is `0`
because Google has no per-token cache-write category — an explicit cache is billed as storage
per hour, which is not a `TokenCounts` field and is not modelled, and OMP reports
`cacheWrite: 0` on every Gemini line anyway.

> Trap: the bundled rates already carry `gemma4` / `ollama-cloud`. That is an Ollama Cloud
> model, not Google Gemini, and not this.

Field differences from the 2026-09-02 Anthropic fixture, across those 374 lines:

- `message.usage.reasoningTokens` — present on 368, absent on 6; `7`–`6984` where present.
  **Unused**, exactly like `cost` and `totalTokens`, and resolved before the rate was seeded:
  `totalTokens === input + output + cacheRead + cacheWrite` on all 374 lines, `reasoningTokens`
  is always strictly less than `output`, and Google's published output price includes thinking
  tokens. So `output` already pays for reasoning; a fifth billed token kind would double-count.
  `TokenCounts` stays input / output / cacheRead / cacheWrite.
- `cacheRead` is frequently non-zero; `cacheWrite` was `0` on every one of the 374 lines (the
  key is present, the value is `0`).
- `usage.cost.total` is usually non-zero, unlike Ollama Cloud's `cost.total: 0`. Still unused:
  the estimate is recomputed from `price_entries` for Gemini lines exactly as for every other
  line.

Fixture: [`fixtures/omp-gemini-session-line.json`](fixtures/omp-gemini-session-line.json) — one
real assistant turn (4159 input / 155 output / 187535 cacheRead / 0 cacheWrite, 110
`reasoningTokens`), message content replaced with `REDACTED` and nothing else altered.
`packages/collectors` prices it from the bundled rate to a locked **1.7765625 cents**; the line's
own `usage.cost.total` ($0.017765625) agrees to the fraction, which is all that number is good
for — the estimate still comes from `price_entries`.

### Per-account split: not needed, and not possible here

`provider` is present but there is no account id, key hash, or subscription marker on a usage
line (`credential_pin.hash` exists but is per-provider, not per-account). Model-level breakdown
is all the log supports — matches the locked decision.

### Dedupe key

Preferred: `omp:<sessionId>:<message.id>`. `message.id` is only unique inside one file, so the
session uuid is required; the session uuid comes from the header line, which the parser must read
before the messages it scopes.

Fallback, if a file has no header line: hash of `filePath + byteOffset`. Do **not** hash
timestamp+model+tokens alone — two identical tiny turns in one session collide.

`omp_sync_state` keys on `path` with `mtime` + `offset`, so a resumed file needs its session uuid
cached alongside the offset, or re-read from line 1 (cheap: it is the first line).

---

## Cursor (Pro)

Auth: key-only read of `cursorAuth/accessToken` from
`~/Library/Application Support/Cursor/User/globalStorage/state.vscdb` (`ItemTable`, `key` is the
primary key). Open read-only + `immutable=1`; the file is ~90 MB here and Cursor may hold a WAL.
The value is a `session`-type JWT (`iss: authentication.cursor.sh`, `aud: cursor.com`, ~1 year
`exp`); `sub` is the WorkOS user id and is needed to build the cookie.

Request — `POST https://cursor.com/api/dashboard/get-aggregated-usage-events`:

- `Cookie: WorkosCursorSessionToken=<urlencoded sub>%3A%3A<jwt>`
- `Origin: https://cursor.com` — **required**. Without it: `403 {"error":"Invalid origin for state-changing request"}`.
- Body `{}` → current billing cycle. `Authorization: Bearer` and `api2.cursor.sh` both fail (404 / no route).

Response (rounded fixture, structure verbatim):

```json
{
  "aggregations": [
    { "modelIntent": "claude-opus-5-thinking-high", "inputTokens": "164", "outputTokens": "82300",
      "cacheWriteTokens": "778000", "cacheReadTokens": "7350000", "totalCents": 1059.88, "tier": 1 }
  ],
  "totalInputTokens": "13014000", "totalOutputTokens": "1500000",
  "totalCacheWriteTokens": "852000", "totalCacheReadTokens": "124722000",
  "totalCostCents": 9914.55
}
```

### `CursorSnapshot` (`mode: "cycle_aggregate"`) mapping

| Our field | Cursor source | Notes |
|-----------|---------------|-------|
| `cycleStart` | `billingCycleStart` from `POST /api/usage-summary` | **Not in the aggregate response** — second call required |
| `cycleEnd` | `billingCycleEnd` from the same call | ISO 8601 UTC; here `2026-08-26T07:25:29Z → 2026-09-26T07:25:29Z`, i.e. not month-aligned |
| `models[].model` | `modelIntent` after the alias map | Only identifier present; no display name |
| `models[].tokens.input` | `inputTokens` | **Decimal string**, parse it |
| `models[].tokens.output` | `outputTokens` | string |
| `models[].tokens.cacheRead` | `cacheReadTokens` | string; **key absent** when zero |
| `models[].tokens.cacheWrite` | `cacheWriteTokens` | string; **key absent** when zero |

`modelIntent` is the only model field — there is no separate `model` / display name, so commit 6's
map is `modelIntent → canonical id`. Values seen: `cursor-grok-4.6-high`,
`cursor-grok-4.6-high-fast`, `cursor-grok-4.5-high-fast`, `claude-opus-5-thinking-high`,
`gpt-5.6-sol-medium`, and `default`. Notable shapes the map must handle:

- `default` = Auto model selection. Not a real model; it has real tokens (3.2 M input here) and no
  resolvable public rate. This is the first guaranteed unknown-price row → Settings.
- Thinking / effort / speed suffixes (`-thinking-high`, `-high-fast`) must collapse onto the base
  model to match an OMP row and a price entry.
- `cursor-` prefixed models are Cursor-hosted; public PAYG rates may not exist for all of them.

`totalCents` / `totalCostCents` are Cursor's own billing numbers, **fractional cents** as floats.
Ignored for our estimate (we price from `price_entries`), and never mixed into `estimatedCents`.
`tier` (1 or 2) is a Cursor pricing bucket; not modelled.

`/api/usage-summary` also returns `membershipType: "pro"` — the cheap way to decide Pro vs
Enterprise without a `crsr_` key — plus included-quota percentages that are explicitly out of scope.

---

## Finding: Cursor Pro *does* accept date windows

The locked decision says calendar filters cannot apply to Cursor Pro. That is **wrong on this
account**. `get-aggregated-usage-events` accepts `{ "teamId": 0, "startDate": "<epoch ms>",
"endDate": "<epoch ms>" }` (numbers as strings) and returns a narrowed aggregate:

| Window | rows | totalCostCents |
|--------|------|----------------|
| `{}` (default) | 6 | 9914.55 |
| explicit cycle start → now | 6 | 9914.55 (identical, confirms the default) |
| today 00:00 UTC → now | 5 | 1820.87 |
| 30 days **before** cycle start | 1 | 9.38 |

So per-day and pre-cycle windows both work, and the response is still per-model aggregates — never
events, so per-event timestamps still need an Enterprise `crsr_` key.

One hard constraint: a window may not span both `2025-08-01` and `2026-05-14`. Crossing either
boundary returns `ERROR_BAD_REQUEST` — *"spans both before … and after …, which no single backend
can serve. Split the query at one of those dates"*. All-time therefore needs up to three calls,
merged client-side.

**Not acting on this in this commit.** It changes product behaviour (mixed-period labelling, the
cycle banner, whether "Today" applies to Cursor), so it is a decision, not a spike output.
`docs/product.md` and `docs/implementation-plan.md` now carry a pointer here. Until that decision
is made, build cycle-aggregate mode: it is the correct subset either way, and `CursorSnapshot`
already keeps the union open.

---

## Confirmed on this machine

- OMP assistant lines carry ISO timestamp, model id, and input / output / cacheRead / cacheWrite.
- OMP subagent transcripts are separate nested files with their own usage.
- Cursor Pro returns per-model input / output / cache tokens. **The dashboard is viable.**
- Cursor auth is a single-key lookup; no full-table scan needed.
- Billing cycle dates are available (from `usage-summary`, not the aggregate response).
- Cursor Pro accepts arbitrary date windows (see above).
- OMP routes Gemini through Antigravity on this machine: `gemini-3.8-flash` /
  `google-antigravity` / `google-gemini-cli`, 374 assistant lines, same line shape and still
  `source: "omp"` (2026-09-04).
- Gemini `reasoningTokens` needs no billing of its own: `totalTokens` equals the four counted
  kinds on all 374 lines, `reasoningTokens` never exceeds `output`, and Google's output price
  includes thinking tokens. Checked before seeding the rate (2026-09-04).

## Assumed / unknown

- Alias mapping from `modelIntent` to canonical ids is unverified; only 6 values observed on one account.
- No public PAYG rate exists for `default` (Auto) or for some `cursor-*` models → `estimatedCents: null` is a real, common state, not an edge case.
- Cursor cache-token semantics (5m vs 1h TTL, read vs write pricing) not verified against Anthropic's tiers.
- Ollama Cloud lines report `cost.total: 0`; whether we treat Ollama Cloud as free or price it is a pricing decision.
- OMP session-log format is `version: 3`; no compatibility guarantee across OMP updates.
- `teamId: 0` was accepted but untested for a real team account.
- `gemini-3.8-flash` is the only Gemini id seen. Other Gemini ids (Pro tiers, dated
  snapshots) may appear under different routing and are simply unobserved, not ruled out.

## Blockers

None. Cursor Pro per-model tokens exist, so commit 4 can freeze the types.

---

## Re-running the spike

```
node scripts/spike/dump-shapes.mjs          # prints shapes; never prints the access token
node scripts/spike/dump-shapes.mjs out/     # also writes raw, UNREDACTED dumps to out/ (gitignored)
```

Zero dependencies: `node:sqlite` + `fetch` on Node 24+. It reads the token straight from
`state.vscdb`, so no token is ever pasted into a shell, a file, or this repo. Redact `cwd`,
`responseId`, and message content before any raw dump becomes a fixture.

`dump-shapes.mjs` samples **one** usage line, so it cannot enumerate model ids: the
2026-09-04 triples came from scanning every assistant line under the sessions directory.

