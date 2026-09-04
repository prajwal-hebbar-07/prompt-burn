# Core domain (types, period filter, aggregation)

> **Plain English:** [The ledger](../plain-english/04-the-ledger.md)

## 1. Purpose

`packages/core` (`@prompt-burn/core`) is the shared vocabulary of the project: the TypeScript
types every collector writes and the dashboard renders, plus the pure functions that turn raw
usage into a view model. It holds no I/O of its own — no filesystem, no network, no database.
Everything here takes data in and returns data out, which is what makes the timestamp math and
the aggregation testable to the millisecond.

Four commits built it: 1-core froze the types, 6a437ff added the period filter with
local-midnight bounds, 1a81799 added `canonicalModelId` for Cursor model normalization, and
7862c7b added `buildDashboardSnapshot`, the aggregation into the dashboard view model.

## 2. Inventory

| File                                  | Kind   | Role                                             |
| ------------------------------------- | ------ | ------------------------------------------------ |
| `packages/core/src/index.ts`          | Source | Domain types + package public re-exports         |
| `packages/core/src/period.ts`         | Source | Calendar period filtering, device timezone       |
| `packages/core/src/model.ts`          | Source | Model id normalization to canonical ids          |
| `packages/core/src/aggregate.ts`      | Source | OMP + Cursor snapshot into `DashboardSnapshot`   |
| `packages/core/src/period.test.ts`    | Test   | Local-midnight boundary behaviour (IST-pinned)   |
| `packages/core/src/model.test.ts`     | Test   | Suffix collapse and passthrough rules            |
| `packages/core/src/aggregate.test.ts` | Test   | Aggregation, mixed-period flag, row keying       |
| `packages/core/vitest.config.ts`      | Config | Pins test timezone to `Asia/Kolkata`             |
| `packages/core/package.json`          | Config | `@prompt-burn/core`, ESM, source exports, vitest |
| `packages/core/tsconfig.json`         | Config | TypeScript project for `typecheck`               |

## 3. Public surface

Single entry point: `@prompt-burn/core` → `packages/core/src/index.ts` (both `types` and
`default` point at the source file — no build step, consumers compile it themselves).

Types (all exported from `index.ts`):

```ts
type Source = "omp" | "cursor";

interface TokenCounts {
  input: number;
  output: number;
  // optional: Cursor omits when zero; OMP always reports
  cacheRead?: number;
  cacheWrite?: number;
}

interface UsageEvent {
  // stable per-source id, e.g. `omp:${sessionId}:${line.id}`
  id: string;
  source: Source;
  timestamp: string; // ISO 8601, UTC
  model: string; // canonical id after normalization
  rawModel: string; // id exactly as the source reported it
  tokens: TokenCounts;
  sessionId?: string;
}

type PeriodFilter =
  | { kind: "today" }
  | { kind: "this_month" }
  | { kind: "all_time" }
  // YYYY-MM-DD; end day inclusive
  | { kind: "range"; start: string; end: string };

interface ModelAggregate {
  model: string;
  tokens: TokenCounts;
}

interface SourceTotals {
  // null = at least one price unknown
  estimatedCents: number | null;
  tokens: TokenCounts;
}

type CursorSnapshot =
  | {
      mode: "cycle_aggregate";
      cycleStart: string;
      cycleEnd: string;
      models: ModelAggregate[];
    }
  // Enterprise path, unimplemented
  | { mode: "events"; events: UsageEvent[] };

interface FetchState {
  status: "idle" | "fetching" | "error";
  lastSuccessAt: Date | null;
  error?: string;
}

interface DashboardSnapshot {
  period: PeriodFilter;
  estimatedCents: number | null;
  omp: SourceTotals;
  cursor: SourceTotals & {
    mode: CursorSnapshot["mode"];
    /** e.g. "Cycle to date". */
    cycleLabel?: string;
  };
  /** Rows keyed (source, model); same model twice is expected. */
  models: Array<
    ModelAggregate & {
      source: Source;
      estimatedCents: number | null;
    }
  >;
  /** Cursor is cycle-only while the period is not all-time-equivalent. */
  mixedPeriod: boolean;
  fetch: {
    lastSuccessAt: string | null;
    status: FetchState["status"];
    error?: string;
  };
}

interface SnapshotInput {
  period: PeriodFilter;
  /** OMP usage events; model already canonical. Filtered by period. */
  ompEvents: readonly UsageEvent[];
  cursor: CursorSnapshot;
  /** Injectable clock. */
  now?: Date;
  /** Owned by the shell that fetched; aggregation never invents an error. */
  fetch?: DashboardSnapshot["fetch"];
}
```

Functions (three defined in sibling modules, re-exported from `index.ts`):

```ts
// period.ts
function periodBounds(
  period: PeriodFilter,
  now?: Date,
): { start: number | null; end: number | null };
function filterEventsByPeriod(
  events: readonly UsageEvent[],
  period: PeriodFilter,
  now?: Date,
): UsageEvent[];

// model.ts
function canonicalModelId(rawModel: string): string;

// aggregate.ts
const CURSOR_CYCLE_LABEL: "Cycle to date";
function buildDashboardSnapshot(input: SnapshotInput): DashboardSnapshot;
```

`now` is injectable everywhere so `today` / `this_month` are testable; it defaults to the wall
clock. `periodBounds` returns a half-open `[start, end)` in epoch ms, `null` meaning unbounded.

## 4. Flow

```mermaid
flowchart TD
    A[raw inputs<br/>ompEvents: UsageEvent[] + cursor: CursorSnapshot] --> B{cursor.mode?}
    B -- events --> C[filterEventsByPeriod<br/>same period as OMP]
    B -- cycle_aggregate --> D[passthrough<br/>never filtered, never split]
    A --> E[filterEventsByPeriod<br/>local-midnight bounds]
    C --> F[rollup source=cursor]
    E --> G[rollup source=omp]
    D --> F
    F & G --> H[buildDashboardSnapshot<br/>merges both rollups<br/>mixedPeriod, cycleLabel, fetch]
    H --> I[DashboardSnapshot<br/>frozen contract for the UI]
```

Three steps, all inside the package:

1. **Period filter** (`period.ts`). `periodBounds` turns a `PeriodFilter` into half-open epoch-ms
   bounds built from _local_ midnights — `new Date(y, m, d)` — with the day/month field rolled
   past its end (`d + 1`, `m + 1`) so the runtime resolves month length, leap years and DST.
   `all_time` returns `{ null, null }` and the filter returns a shallow copy untouched.
   `filterEventsByPeriod` keeps events with `start <= t < end`; events with unparsable
   timestamps survive only `all_time`.
2. **Model normalization** (`model.ts`). `canonicalModelId` strips two named suffixes —
   `-thinking-high` → base, `-high-fast` → `-high` — so Cursor rows collapse onto the same
   canonical id as the OMP row and the price entry. Everything else passes through: OMP ids,
   unknown strings, `default` (Auto), the `cursor-` prefix (never stripped), and a bare suffix
   with no base model is kept verbatim rather than emptied.
3. **Aggregation** (`aggregate.ts`). `buildDashboardSnapshot` filters OMP events by period,
   rolls each source into per-model rows and a subtotal via `rollup`, and assembles the
   snapshot. `cycle_aggregate` Cursor data is used exactly as fetched — no timestamps, so never
   filtered; `events` mode takes the same filter as OMP.

Costs are never computed here: every `estimatedCents` in a snapshot is `null` at this commit
(the price DB lives in `packages/db` and is wired later); the UI renders `null` as `—`, never
`$0`.

## 5. Contracts and invariants

- **`DashboardSnapshot` is a frozen contract for the UI.** Consumers read it; nothing outside
  the package may extend its shape casually.
- **Timestamps are UTC ISO 8601; period bounds are device-local.** The boundary is always the
  local wall-clock midnight, never UTC midnight — `Date.parse` on the UTC timestamp vs `new
Date(y, m, d)` on the local wall clock. In IST, local midnight 1 Jan is 18:30 UTC the day
  before, so a UTC-midnight bug visibly shifts the split.
- **`all_time` is the pass-through filter.** Bounds `{ null, null }`; every event survives,
  including ones with unparsable timestamps.
- **Range end is inclusive in UI terms.** `{ kind: "range", start: D, end: D }` is that one
  local day; code converts the inclusive end day to the exclusive next-day 00:00 via
  `localMidnight(end, 1)`.
- **`localMidnight` accepts only `YYYY-MM-DD`** (`^(\d{4})-(\d{2})-(\d{2})$`) and throws
  `RangeError` otherwise, or when the constructed date is invalid.
- **Rows are keyed `(source, model)` and never merged across sources.** The same model on OMP
  and Cursor is deliberately two rows; rows keep first-seen order. Unknown ids and `default`
  (Auto) stay as rows — an unpriceable model must remain visible, not vanish.
- **Sources are never deduped in totals.** Combined usage is the plain sum of the two
  subtotals.
- **Cursor cycle scope never shrinks.** `cycle_aggregate` numbers are identical under every
  period; the snapshot flags the mismatch with `mixedPeriod = true` for every period except
  `all_time`, and always footnotes it with `cycleLabel: "Cycle to date"`.
- **Cursor cache keys are optional.** `TokenCounts.cacheRead/cacheWrite` may be absent (Cursor
  omits them when zero); aggregation treats absent as 0.
- **Aggregation never invents fetch state.** `fetch` defaults to `{ lastSuccessAt: null,
status: "idle" }`; the shell that fetched owns anything else.
- **`canonicalModelId` is idempotent** and total: a bare suffix (`"-thinking-high"`) is kept
  verbatim; `""` maps to `""`.

## 6. Configuration

None. The package is pure — no env vars, no config files, no runtime options. Two pieces of
configuration exist and both are about _tests_, not runtime:

- `vitest.config.ts` pins `TZ=Asia/Kolkata` for the whole test run. Period bounds are
  device-local, so boundary tests must exercise real local-midnight math; IST (UTC+5:30, no
  DST) is chosen because its half-hourly offset means a UTC-midnight bug cannot pass by
  accident. `period.test.ts` asserts the pin took effect (it also accepts Node's
  `Asia/Calcutta` alias echo).
- `package.json` is source-only: `exports` points at `./src/index.ts`, so there is no build
  output to configure; scripts are `typecheck` (`tsc -p .`) and `test` (`vitest run`).

## 7. Boundaries and dependencies

- **Zero runtime dependencies.** Only dev dependency is `vitest ^4.0.18`. Nothing in
  `packages/core/src` imports anything but its own siblings (`./index.js`, `./period.js`).
- **No I/O.** No `node:fs`, no fetch, no sqlite — a collector hands it arrays and objects.
- **Consumed by:**
  - `packages/collectors` — imports `canonicalModelId` and `UsageEvent`; OMP transcript
    collection writes events into the sqlite DB using these types.
  - `packages/db` — prices are keyed by the same canonical id `canonicalModelId` produces; the
    comment in `packages/db/src/prices.ts` names core as the source of that convention.
  - The future UI — `DashboardSnapshot` is built for it and currently only exercised by tests.
- **Upstream contracts it encodes** (from the spike, `docs/data-shapes.md`): OMP writes UTC
  timestamps and full token objects; Cursor returns decimal-string tokens, omits zero cache
  keys, and (Pro) returns cycle-to-date aggregates with no per-event timestamps.

## 8. Tests

`vitest run` passes: 3 files, 22 tests. All run with `TZ=Asia/Kolkata`.

- **`period.test.ts`** — a "timezone setup" guard asserts the run really is in IST (accepting
  the `Asia/Calcutta` alias) and that local midnight on 1 Jan is `2026-12-31T18:30:00.000Z` —
  the +05:30 proof. Then: `this_month` splits on local midnight of the 1st (Aug 31 23:59:59.999
  IST excluded, Sep 1 00:00:00.000 kept, Sep 30 23:59:59.999 kept, Oct 1 excluded) and the
  same across a year boundary; `today` spans one local midnight to the next and rolls into the
  new year; `range` treats `start === end` as that single day, includes the whole inclusive end
  day, and rejects non-`YYYY-MM-DD` strings with `RangeError`; `all_time` keeps everything,
  any date.
- **`model.test.ts`** — the two named suffixes collapse (`claude-opus-5-thinking-high` →
  `claude-opus-5`, `cursor-grok-4.6-high-fast` → `cursor-grok-4.6-high`); the rest of the
  observed Cursor set is untouched (`-medium` not stripped, `cursor-` prefix kept, `default`
  stays); OMP ids and unknown strings pass through; a bare suffix is kept verbatim; idempotence
  over representative inputs.
- **`aggregate.test.ts`** — with a fixed injected `now` (2 Sep 2026, 18:00 IST): OMP filtered
  by the period while the Cursor cycle is identical under today and all-time; combined totals
  are the plain sum without dedupe; `mixedPeriod` true for today/this_month/range and false
  only for all-time, with the cycle label always set; rows keyed `(source, model)` so
  `claude-opus-5` appears twice; every cost `null`; fetch defaults to idle. Edge cases: empty
  inputs give zero totals, no rows, and still `mixedPeriod: true`; Cursor `events` mode is
  filtered like OMP with no cycle label and `mixedPeriod: false`; an explicit `fetch` object
  passes through untouched.

**Not covered:** `this_month` in a DST-transitioning timezone (IST has none, so the DST-rolling
claim is untested); unparsable-timestamp events under bounded periods (the "survive only
`all_time`" rule has no direct assertion); no test pins `buildDashboardSnapshot` against a
`DashboardSnapshot`-typed snapshot of a real collector's output; nothing covers the `id` /
`sessionId` fields, which only producers touch.

## 9. Debt and traps

- **Device-local timezone is the real one.** Tests pin IST, but production runs in whatever
  timezone the user's device has — DST zones will exercise the day-rollover path for real.
  That path is code-reviewed, not machine-tested (§8). Do not "fix" the tests to UTC; the
  local-midnight semantics are the point.
- **`canonicalModelId` rests on six observed strings from one account.** The suffix rule list
  is deliberately a list, not a catalog: an unmapped id survives verbatim and surfaces as an
  unknown-price row instead of vanishing. New observed suffixes go in `SUFFIX_RULES` with a
  test; never invent stripping for a suffix nobody saw (`-medium` is the standing example).
- **`-high-fast` ordering matters.** Rules are checked in array order; `-thinking-high` before
  `-high-fast` is fine today because the strings do not overlap, but any new suffix must be
  checked for overlap with existing ones.
- **Every `estimatedCents` is hard-coded `null` at this commit.** The price DB exists in
  `packages/db` but the wiring is a later commit; until then, `null` is not a bug. Any change
  that starts filling costs must also decide the null-propagation rule already documented on
  `SourceTotals` (`null` = at least one price unknown).
- **Cursor `events` mode is a contract placeholder.** The Enterprise path (`crsr_` admin key)
  is unimplemented; the union arm exists so adding it later is not a breaking change. It is
  tested only with synthetic events.
- **`CursorSnapshot.cycleStart/cycleEnd` are stored but unused by aggregation** — the cycle
  window does not bound the Cursor rollup by design (the cycle never shrinks). A future change
  that tries to intersect the cycle with the period would break the `mixedPeriod` contract.

## 10. Change guide

- **Adding a collector or a source:** extend `Source` and the matching collector package; add
  the second arm to any union that enumerates sources. `buildDashboardSnapshot` currently
  hard-codes exactly two sources (`omp`, `cursor`) — a third source means touching its
  return-shape, `mixedPeriod` logic, and `models` concatenation.
- **Adding a period kind:** extend `PeriodFilter`, add a `case` to `periodBounds`'s exhaustive
  switch (TS will force it), and add boundary tests in the IST-pinned file. Keep bounds
  half-open `[start, end)`; keep `all_time` as the only pass-through.
- **Adding a normalization rule:** append to `SUFFIX_RULES` in `model.ts` with a comment
  naming the observed raw value, then extend `model.test.ts`. Re-check ordering against
  existing suffixes for overlap.
- **Changing `DashboardSnapshot`:** it is the frozen UI contract — change it together with the
  UI that renders it, never in a collectors-only commit. Bump the relevant test fixtures in
  `aggregate.test.ts` in the same commit.
- **Wiring in costs:** replace the `estimatedCents: null` constants in `rollup` when the price
  DB lands; keep `null` for any row containing an unknown price, and keep the UI rendering
  `null` as `—`.
- **Changing tests' timezone:** update `vitest.config.ts` and the setup guard in
  `period.test.ts` together — the guard exists to fail loudly if the pin silently stops
  working. Any new pinned timezone must have a non-hourly UTC offset.
