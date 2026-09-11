# Data-shape spike — OMP and Cursor Pro

Spiked on this machine (macOS, 2026-09-02) before freezing `packages/core` types in commit 4.
Fixtures: [`fixtures/omp-session-line.json`](fixtures/omp-session-line.json),
[`fixtures/omp-gemini-session-line.json`](fixtures/omp-gemini-session-line.json),
[`fixtures/cursor-cycle-aggregates.json`](fixtures/cursor-cycle-aggregates.json),
[`fixtures/cursor-usage-summary.json`](fixtures/cursor-usage-summary.json),
[`fixtures/ollama-usage.json`](fixtures/ollama-usage.json),
[`fixtures/antigravity-quota-summary.json`](fixtures/antigravity-quota-summary.json).
A second OMP scan on 2026-09-04 added Gemini through Antigravity — see
[Gemini through Antigravity](#gemini-through-antigravity--second-scan-2026-09-04). On 2026-09-11
the Antigravity provider was unlinked from OMP and the standalone `agy` CLI installed, which
moved its quota clocks off `usage_history` and onto a direct call — see
[Antigravity quota](#antigravity-quota--v1internalretrieveuserquotasummary-2026-09-11).

A Claude Code section was written on 2026-09-09 from the collector code and Anthropic's
documented transcript format — **not** from a local transcript; see
[Claude Code](#claude-code).

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
| `project` | `cwd` from the file's `type: "session"` line — the directory that owns the usage | `/Users/example/project` |

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

### Per-account split: not needed for usage, and not possible from a session line

`provider` is present but there is no account id, key hash, or subscription marker on a usage
line (`credential_pin.hash` exists but is per-provider, not per-account). Model-level breakdown
is all the log supports — matches the locked decision.

Provider **limits** are a different table and do carry the account; see
[Provider usage clocks](#provider-usage-clocks--usage_history-2026-09-05).

### Provider usage clocks — `usage_history`, 2026-09-05

OMP asks each provider what is left on the subscription and appends every answer to
`usage_history` in `~/.omp/agent/agent.db` (the sibling of the sessions directory). It also
caches the whole report in `cache` under `usage_cache:report:…`, with a ~6-minute expiry — the
history table is the durable copy, so that is what Prompt Burn reads.

```sql
CREATE TABLE usage_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, recorded_at INTEGER NOT NULL,
  provider TEXT NOT NULL, account_key TEXT NOT NULL, email TEXT, account_id TEXT,
  limit_id TEXT NOT NULL, label TEXT NOT NULL, window_label TEXT,
  used_fraction REAL, status TEXT, resets_at INTEGER)
```

| Our field | `usage_history` column | Example |
|-----------|------------------------|---------|
| grouping key (never exposed) | `provider` + `account_key` | `anthropic` + `oauth\|account:…\|email:…\|org:…` |
| `ProviderLimits.account` | `email` — absent when the column is `NULL` | `you@example.com` |
| `UsageLimit.id` | `limit_id` | `anthropic:5h`, `google-antigravity:google:default:gemini-weekly` |
| `UsageLimit.label` | `label` | `Claude 5 Hour`, `Usage (Google)` |
| `UsageLimit.windowLabel` | `window_label` | `5 Hour`, `7 Day`, `Weekly`, `extra` |
| `UsageLimit.usedFraction` | `used_fraction` (0–1, `NULL` when the provider gave no number) | `0.38` |
| `UsageLimit.resetsAt` | `resets_at` — **epoch milliseconds**, `NULL` when no window is running | `1788626400097` |
| `ProviderLimits.observedAt` | `recorded_at` — epoch milliseconds | `1788609218274` |

Confirmed on this machine: `anthropic` (two accounts, ids `anthropic:5h` / `:7d` / `:extra`) and,
until the provider was unlinked on 2026-09-11, `google-antigravity`. `ollama-cloud` writes **no
rows at all**: its cached report is
`{ limits: [], notes: ["Ollama does not expose a standalone quota usage API…"] }`. That note is
out of date — see [Ollama Cloud usage](#ollama-cloud-usage--apiusage-2026-09-05), which Prompt
Burn fetches for itself rather than waiting for OMP to record it.

**Antigravity no longer arrives this way.** With the provider unlinked from OMP and the
standalone `agy` CLI installed, `usage_history` stops gaining `google-antigravity` rows while the
CLI keeps burning the same account-level pool, so Prompt Burn asks Google itself — see
[Antigravity quota](#antigravity-quota--v1internalretrieveuserquotasummary-2026-09-11). A fetched
card always replaces any `usage_history` rows for the same provider; two cards for one
subscription is worse than a stale one.

Reading notes, all of them load-bearing:

- The table is a **series**, one row per limit per refresh (371 rows here). Only the newest row
  per `(provider, account_key, limit_id)` is current.
- `email` **is** read and shown: the panel names each account so the right subscription can be
  pinned in OMP without guessing which of `Account A` / `B` it was. `account_id` is still not
  read — a UUID names nothing to a human. A provider whose rows carry no email (an API key
  rather than an OAuth account) keeps the `Account A` / `B` fallback.
- Rows for a **removed** credential are never deleted, so observations older than 7 days (the
  longest window a provider reports) are dropped rather than shown as current.
- `anthropic:extra` is dollars, not a clock: `used_fraction` is the fraction of the extra-usage
  cap, and `resets_at` is `NULL`. The raw report has `extra_usage.monthly_limit` in credits;
  none of that is read.
- The database is **live** — OMP writes it while the app reads — so the open is `mode=ro`
  *without* `immutable=1`, unlike Cursor's `state.vscdb`.
- `status` (`ok` observed) is not read: the percentage already says when a window is nearly out.

### Antigravity quota — `v1internal:retrieveUserQuotaSummary`, 2026-09-11

`POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary` with an empty
body and `Authorization: Bearer <access token>`. **Internal and undocumented**: the message
names come out of the shipped `agy` binary's embedded descriptors
(`RetrieveUserQuotaSummaryRequest` has one field, `project`, and it is not needed), so every
failure is data — the panel loses one card and nothing else moves.

Two traps, both found by hitting the endpoint:

- The `User-Agent` **must** contain `antigravity`, case-insensitively. `Python-urllib/3.9`,
  `GeminiCLI/1.0` and `prompt-burn/0.1` are all answered `403 PERMISSION_DENIED` /
  `SUBSCRIPTION_REQUIRED (#3501)` — "you do not have a valid license of this product", which
  describes a licensing problem this account does not have.
- Sending `x-goog-user-project` turns the same call into
  `403 Caller does not have required permission to use project aicode-consumers`. Antigravity
  bills through Google's own project; naming one is the error.

Credential: `agy`'s, in the macOS keychain under service `gemini`, account `antigravity`, written
by go-keyring as `go-keyring-base64:<base64 JSON>` holding
`{ token: { access_token, refresh_token, expiry }, auth_method, id_token }`. The access token
lives about an hour, so Prompt Burn refreshes it in memory against
`https://oauth2.googleapis.com/token` with Antigravity's own desktop OAuth client. That pair is
**read out of the installed `~/.gemini/bin/agy` at run time and never committed** — a shipped
OAuth pair in a public repository is what GitHub's push protection blocks, and reading the
binary also means a rotation arrives with the next `agy update` instead of breaking the
collector. The binary carries several pairs and labels none, so each is offered to Google until
one is accepted (a wrong pair answers `401 invalid_client`, which is not the same failure as a
revoked session's `400 invalid_grant`); the accepted pair is then cached per binary path for the
process. Nothing is ever written back to the keychain or to `~/.prompt-burn/db.sqlite`.
`id_token`'s `email` claim names the card.

Response: `groups[]`, each `{ displayName, description, buckets[] }`, each bucket
`{ bucketId, displayName, window, resetTime, description, remainingFraction | remainingAmount,
disabled? }`.

| Our field | Quota source | Example |
|-----------|--------------|---------|
| `ProviderLimits.provider` | constant | `google-antigravity` |
| `ProviderLimits.account` | `email` claim of the keychain `id_token` | `you@example.com` |
| `UsageLimit.id` | `google-antigravity:` + `bucketId` | `google-antigravity:gemini-5h` |
| `UsageLimit.label` | the **group's** `displayName`, in `Usage (…)` form | `Usage (Gemini Models)` |
| `UsageLimit.windowLabel` | `window`, `5h` → `5 Hour` | `5 Hour`, `Weekly` |
| `UsageLimit.usedFraction` | **`1 - remainingFraction`**, clamped | `0.9821167` |
| `UsageLimit.resetsAt` | `resetTime` — already an ISO instant, unlike OMP's epoch ms | `2026-09-11T13:45:43Z` |

Four buckets in two groups on this account: `gemini-5h` / `gemini-weekly` under
**Gemini Models**, and `3p-5h` / `3p-weekly` under **Claude and GPT models**. OMP used to split
that second group into separate Anthropic and OpenAI ids; Google reports one shared pool, and
this reads it as one. The group name is what the panel turns into a heading, so two five-hour
rows never read alike.

Reading notes:

- Google reports what is **left**. The panel shows what is gone, so the inversion happens here
  and nowhere else.
- A bucket carrying `remainingAmount` instead of `remainingFraction` has no percentage:
  `usedFraction: null`, never a zero standing in for silence.
- `disabled: true` is a pool this account does not have. It is dropped, not rendered as 0%.
- `description` ("it will fully refresh in 1 hour, 54 minutes") is prose around the same
  `resetTime` the panel already formats, and is not read.

Fixture: [`fixtures/antigravity-quota-summary.json`](fixtures/antigravity-quota-summary.json) —
one real response, unaltered. It carries no credential.

### Ollama Cloud usage — `/api/usage`, 2026-09-05

`GET https://ollama.com/api/usage` with `Authorization: Bearer <api key>` answers with the
account's two clocks. **Undocumented**: it is what the ollama.com dashboard reads, and Ollama
has three open requests for a supported endpoint (ollama/ollama
[#15132](https://github.com/ollama/ollama/issues/15132),
[#15663](https://github.com/ollama/ollama/issues/15663),
[#16448](https://github.com/ollama/ollama/issues/16448)). `/api/account/usage`, `/api/user`,
`/api/account` and `/api/v1/usage` are all 404; unauthenticated is 401.

The key is the one `ollama login` leaves in OMP's `auth_credentials`
(`provider = 'ollama-cloud'`, `json_extract(data, '$.key')`, 57 chars here, `source: "login"`).
Read at fetch time, used for one header, never stored by us — the same contract as Cursor's
token.

Fixture: [`fixtures/ollama-usage.json`](fixtures/ollama-usage.json) — the real response with
nothing removed; it carries no identifiers.

| Our field | Ollama source | Example |
|-----------|---------------|---------|
| `ProviderLimits.provider` | constant | `ollama-cloud` |
| `ProviderLimits.observedAt` | our own clock at fetch — the payload has no timestamp | `2026-09-05T12:47:59.159Z` |
| `UsageLimit.id` / `label` | constant per window | `ollama-cloud:session`, `Ollama Cloud Session` |
| `UsageLimit.windowLabel` | `Session` / `Weekly` — Ollama's own words | `Session` |
| `UsageLimit.usedFraction` | `limits.session.usage` / `limits.weekly.usage` | `0.037`, `0.358` |
| `UsageLimit.resetsAt` | **nothing to map** — always `null` | |

Reading notes:

- `usage` is read as a **fraction, not a percent**: 0.037 and 0.358 against 27 session and 2147
  weekly requests only makes sense as 3.7% / 35.8%. Both samples are ≤ 1. This is the one
  inference in the mapping — cross-check it against ollama.com/settings, and see
  [Assumed / unknown](#assumed--unknown).
- **No reset instant.** The cadence is public (session 5 hours, weekly 7 days) but the moment
  the window turns over is not in the payload, so the rows carry no clock rather than a
  computed one.
- `activity.cost` (`"0.00000"`, a string) is Ollama's own money figure and is ignored, exactly
  like Cursor's `totalCents`.
- `limits.*.models[].request_count` is a request tally, not tokens — it prices nothing and is
  not read. Token usage for Ollama models still comes from OMP session lines.
- Because this is a network call it happens in `fetch()`, unlike the `usage_history` clocks
  which are re-read per snapshot. A failure never fails the pass: the panel loses one card.

### Dedupe key

Preferred: `omp:<sessionId>:<message.id>`. `message.id` is only unique inside one file, so the
session uuid is required; the session uuid comes from the header line, which the parser must read
before the messages it scopes.

Fallback, if a file has no header line: hash of `filePath + byteOffset`. Do **not** hash
timestamp+model+tokens alone — two identical tiny turns in one session collide.

`omp_sync_state` keys on `path` with `mtime` + `offset`, so a resumed file needs its session uuid
cached alongside the offset, or re-read from line 1 (cheap: it is the first line).

## Claude Code

> **Not spiked — unverified against a local fixture.** Everything in this section is read off
> `packages/collectors/src/claude-code.ts` and Claude Code's documented transcript format.
> There was no Claude Code data on the machine when it was written, so no field here has been
> checked against a real transcript and there is deliberately no fixture. Treat the shape as
> unconfirmed until someone runs Claude Code on this machine and re-reads it.

Source: `~/.claude/projects/<slugified-cwd>/<session-uuid>.jsonl`, one JSON object per line,
walked recursively like OMP's — the CLI the VS Code extension drives and a terminal session
both write here, so one collector covers both. `CLAUDE_CONFIG_DIR` relocates the whole config
directory (the collector then reads `<CLAUDE_CONFIG_DIR>/projects`); Settings' `claude_path`
overrides either. Only the first entry is read if that variable holds a comma-separated list —
a `ponytail:` shortcut recorded in `defaultClaudeDirectory`.

A line counts only when `message.role === "assistant"` and `message.usage` exists. The fields
the parser reads, in the shape it expects them:

```json
{
  "type": "assistant",
  "uuid": "6f1c9b7e-…",
  "requestId": "req_011XYZ",
  "sessionId": "11111111-2222-3333-4444-555555555555",
  "cwd": "/Users/example/project",
  "timestamp": "2026-09-02T08:31:31.505Z",
  "message": {
    "id": "msg_01ABC",
    "role": "assistant",
    "model": "claude-sonnet-4-5-20250929",
    "usage": {
      "input_tokens": 2,
      "output_tokens": 105,
      "cache_read_input_tokens": 37378,
      "cache_creation_input_tokens": 463
    }
  }
}
```

Token keys are Anthropic's API names, not OMP's. **There is no session header**: `cwd` and
`sessionId` sit on every line, so project attribution never depends on line 1 and a resumed
file needs no re-read from the top — the opposite of OMP's scan. `type` is shown above for
realism but the parser does not declare or test it: `message.role === "assistant"` plus a
`message.usage` block is the whole filter, chosen so an unfamiliar or renamed line type
cannot silently drop real usage.

### `UsageEvent` mapping

| Our field | Claude Code source | Example |
|-----------|--------------------|---------|
| `id` | `message.id` + `requestId`, with fallbacks — see [Event id](#event-id-claude-code) | `claude-code:msg_01ABC:req_011XYZ` |
| `source` | constant | `"claude-code"` |
| `timestamp` | top-level `timestamp`; must be a string or the line is skipped | `"2026-09-02T08:31:31.505Z"` |
| `rawModel` | `message.model`, verbatim | `"claude-sonnet-4-5-20250929"` |
| `model` | `canonicalModelId(message.model)` — dated snapshot stripped | `"claude-sonnet-4-5"` |
| `tokens.input` | `message.usage.input_tokens` | `2` |
| `tokens.output` | `message.usage.output_tokens` | `105` |
| `tokens.cacheRead` | `message.usage.cache_read_input_tokens` | `37378` |
| `tokens.cacheWrite` | `message.usage.cache_creation_input_tokens` | `463` |
| `sessionId` | `sessionId`; omitted when it is not a string | `11111111-…` |
| `project` | `cwd` — the directory that owns the usage; omitted when absent or empty | `/Users/example/project` |

Every token field goes through the same `count()` guard OMP's does: a missing key or a
non-finite value becomes `0` rather than failing the line.

Skipped rather than stored:

- `message.model === "<synthetic>"` — Claude Code's stand-in on locally generated messages
  (interrupts, API errors). No provider call happened, so there is nothing to price.
- Anything without `message.usage`, a non-assistant role, or a non-string `timestamp` /
  `message.model`; blank and unparsable lines (a live transcript can be mid-write).
- `costUSD`, which older Claude Code versions wrote — ignored exactly like OMP's
  `message.usage.cost`, because cost is recomputed from `price_entries`.

### Event id (Claude Code)

In falling order of strength:

1. `` `claude-code:${message.id}:${requestId}` `` when both are strings.
2. `` `claude-code:${sessionId ?? "unknown"}:${uuid}` `` — the per-line uuid.
3. `claude-code:` + first 16 hex of `sha256(filePath:byteOffset)`.

The response ids come first for a reason: resuming or branching a session copies earlier turns
into a new transcript with **fresh per-line uuids** but the original `message.id` and
`requestId`, so keying on those is what stops one API response being counted twice across
files. Never a hash of timestamp + model + tokens — two identical tiny turns would collide.
The id is the `usage_events` primary key, so a re-read is idempotent.

### Dated model ids collapse

Claude Code writes Anthropic's dated snapshot ids. `canonicalModelId` strips a trailing
`-YYYYMMDD`, so `claude-sonnet-4-5-20250929` becomes `claude-sonnet-4-5` — the id OMP writes
and the id `price_entries` keys on, which is what makes one model one row and one rate.
`rawModel` keeps the dated string. A value that is *only* a date, with no base model left after
the strip, is kept verbatim rather than reduced to nothing.

### Not deduped against OMP

OMP and Claude Code read different transcript trees, so a turn appears in one or the other and
never both: the two subtotals add up, `(source, model)` keeps them on separate rows, and there
is nothing to dedupe. The overlap is the *subscription*, not the tokens — see
[spec.md § Double counting](spec.md#double-counting-omp-claude-code-and-the-limit-cards).

`omp_sync_state` carries both sources' resume state, keyed by absolute path, so the two trees
cannot collide in it despite the table's OMP-era name.

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
- Body `{}` → current billing cycle. `{ "teamId": 0, "startDate": "<epoch ms>", "endDate": "<epoch ms>" }` → that window only, which is what a calendar filter sends. `Authorization: Bearer` and `api2.cursor.sh` both fail (404 / no route).

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

The same `aggregations` mapping serves both bodies. A windowed call reuses the cycle metadata
the last `{}` call returned and only replaces `models`, plus a `window` recording what was
asked for — that field is how the aggregator knows the rows match the period.

| Our field | Cursor source | Notes |
|-----------|---------------|-------|
| `cycleStart` | `billingCycleStart` from `POST /api/usage-summary` | **Not in the aggregate response** — second call required |
| `cycleEnd` | `billingCycleEnd` from the same call | ISO 8601 UTC; here `2026-08-26T07:25:29Z → 2026-09-26T07:25:29Z`, i.e. not month-aligned |
| `models[].model` | `modelIntent` after the alias map | Only identifier present; no display name |
| `models[].tokens.input` | `inputTokens` | **Decimal string**, parse it |
| `models[].tokens.output` | `outputTokens` | string |
| `models[].tokens.cacheRead` | `cacheReadTokens` | string; **key absent** when zero |
| `models[].tokens.cacheWrite` | `cacheWriteTokens` | string; **key absent** when zero |
| `window.start` / `window.end` | the `startDate` / `endDate` sent, as ISO | Absent on a `{}` call: the rows are then the whole cycle |

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
Enterprise without a `crsr_` key — plus `individualUsage.plan.autoPercentUsed` /
`apiPercentUsed` (19.58 / 32.74 here). Those two feed the Usage limits panel as
`CursorIncludedUsage`, quoted as Cursor's own plan percentages and never mixed into a cost.
Everything else in that block — `used` / `limit` / `breakdown.bonus` credits, `onDemand`,
`limitType`, the `…DisplayMessage` sentences — stays unread.

---

## Finding: Cursor Pro *does* accept date windows

The locked decision used to say calendar filters cannot apply to Cursor Pro. That is **wrong on
this account**. `get-aggregated-usage-events` accepts `{ "teamId": 0, "startDate": "<epoch ms>",
"endDate": "<epoch ms>" }` (numbers as strings) and returns a narrowed aggregate:

| Window | rows | totalCostCents | Checked |
|--------|------|----------------|---------|
| `{}` (default) | 6 | 9914.55 | 2026-09-02 |
| explicit cycle start → now | 6 | 9914.55 (identical, confirms the default) | 2026-09-02 |
| today 00:00 UTC → now | 5 | 1820.87 | 2026-09-02 |
| 30 days **before** cycle start | 1 | 9.38 | 2026-09-02 |
| `{}` (default) | 9 | 14423.37 | 2026-09-07 |
| today 00:00 local → now | 1 | 462.21 | 2026-09-07 |
| this month 1st 00:00 local → now | 8 | 6329.69 | 2026-09-07 |
| yesterday, one whole local day | 1 | 222.70 | 2026-09-07 |
| epoch → now (all time) | — | `ERROR_BAD_REQUEST` | 2026-09-07 |

So per-day and pre-cycle windows both work, and the response is still per-model aggregates — never
events, so per-event timestamps still need an Enterprise `crsr_` key.

One hard constraint: a window may not span both `2025-08-01` and `2026-05-14`. Crossing either
boundary returns `ERROR_BAD_REQUEST` — *"spans both before … and after …, which no single backend
can serve. Split the query at one of those dates"*. All-time therefore needs up to three calls,
merged client-side.

**Acted on 2026-09-07.** Today / This month / Date range now send their own bounds and Cursor
answers for them: `fetchCursorWindowAggregate` in `packages/collectors`, resolved per period by
`createUsageReader`, with `CursorSnapshot.window` telling the aggregator the rows match the
period. All-time still sends `{}` — an unbounded window is exactly the refusal above, and the
three-call split needed to work around it turns on two account-specific dates lifted from an
error message, which is not worth hard-coding. When the windowed call fails for any reason the
cycle comes back, labelled as the cycle and excluded from the combined total.
Fixture: [`fixtures/cursor-window-aggregates.json`](fixtures/cursor-window-aggregates.json) —
one real today-window response from this account, structure verbatim.

**Empty windows answer `200 {}`, checked 2026-09-08.** A window Cursor recorded no usage in
comes back as a bare `{}` — no `aggregations` key, no totals — while the neighbouring days on the
same account returned rows (Sep 1 → 5 rows, Sep 2 → 6, Sep 3 → 1, … Sep 8 → `{}`). That is zero
usage, not a broken payload, so `aggregateModels` maps a missing `aggregations` to no rows and
throws only when the key is present with the wrong type. Treating `{}` as a failure is what made
an idle Cursor day fall back to the whole billing cycle and drop out of the day's total.

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
- OMP records provider usage clocks per account in `~/.omp/agent/agent.db` `usage_history`:
  `anthropic` 5-hour / 7-day / extra for two accounts, `google-antigravity` six pools for one,
  `ollama-cloud` nothing at all (2026-09-05).
- Ollama Cloud **does** serve usage after all, at the undocumented
  `GET https://ollama.com/api/usage` with the login API key: `limits.session.usage` and
  `limits.weekly.usage`, no reset instants (2026-09-05).

## Assumed / unknown

- Alias mapping from `modelIntent` to canonical ids is unverified; only 6 values observed on one account.
- No public PAYG rate exists for `default` (Auto) or for some `cursor-*` models → `estimatedCents: null` is a real, common state, not an edge case.
- Cursor cache-token semantics (5m vs 1h TTL, read vs write pricing) not verified against Anthropic's tiers.
- Ollama Cloud lines report `cost.total: 0`; whether we treat Ollama Cloud as free or price it is a pricing decision.
- OMP session-log format is `version: 3`; no compatibility guarantee across OMP updates.
- `teamId: 0` was accepted but untested for a real team account.
- **Every Claude Code field above is unverified on this machine.** The layout, the
  `message.usage.*` key names, the presence of `requestId` / `uuid` / `cwd` on each line and
  the `<synthetic>` model are all taken from the documented format, not from a transcript here.
  First machine with real Claude Code data should re-read the section and add a redacted
  fixture.
- `gemini-3.8-flash` is the only Gemini id seen. Other Gemini ids (Pro tiers, dated
  snapshots) may appear under different routing and are simply unobserved, not ruled out.
- `limits.*.usage` from Ollama's `/api/usage` is read as a 0–1 fraction. Both observed values
  are ≤ 1 and a percent reading would make 2147 weekly requests round to nothing, but Ollama
  documents neither the field nor the endpoint. Cross-check against ollama.com/settings.
- Ollama's `/api/usage` is undocumented and may change or disappear without notice; three open
  feature requests are asking for a supported replacement.

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

