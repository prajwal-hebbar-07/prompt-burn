# Data-shape spike — OMP and Cursor Pro

Spiked on this machine (macOS, 2026-09-02) before freezing `packages/core` types in commit 4.
Fixtures: [`fixtures/omp-session-line.json`](fixtures/omp-session-line.json),
[`fixtures/cursor-cycle-aggregates.json`](fixtures/cursor-cycle-aggregates.json),
[`fixtures/cursor-usage-summary.json`](fixtures/cursor-usage-summary.json).

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
| `rawModel` | `line.message.model` — **no provider prefix** | `"claude-opus-5"`, `"glm-5.3-flash"` |
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
- `message.provider` / `message.api` — `"anthropic"` / `"ollama-cloud"`, `"anthropic-messages"` / `"ollama-chat"`. Useful for the alias map's provider column and for choosing bundled rates.
- `message.contextSnapshot.promptTokens` — context-window gauge, **not** billable input.

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

## Assumed / unknown

- Alias mapping from `modelIntent` to canonical ids is unverified; only 6 values observed on one account.
- No public PAYG rate exists for `default` (Auto) or for some `cursor-*` models → `estimatedCents: null` is a real, common state, not an edge case.
- Cursor cache-token semantics (5m vs 1h TTL, read vs write pricing) not verified against Anthropic's tiers.
- Ollama Cloud lines report `cost.total: 0`; whether we treat Ollama Cloud as free or price it is a pricing decision.
- OMP session-log format is `version: 3`; no compatibility guarantee across OMP updates.
- `teamId: 0` was accepted but untested for a real team account.

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
