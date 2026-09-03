# Repo scaffold and workspace tooling

> **Plain English:** [The workshop](../plain-english/01-the-workshop.md).

## 1. Purpose

This repository is a greenfield pnpm workspace for **prompt-burn**, a local dashboard that reads OMP
and Cursor token usage and prices it at estimated pay-as-you-go rates. At the current HEAD
(`836d6c3`) the repo contains only the scaffold: the shared configuration every future package will
inherit, the planning documents, and a data-shape spike. No product code exists yet. This document
records exactly what the scaffold contains today, what the workspace declares for tomorrow, and
where the two diverge.

Sources: root `README.md`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
`tsconfig.json`, `.nvmrc`, `.gitignore`, and `docs/implementation-plan.md`
§ "Package layout (create as you go)".

## 2. Inventory

Everything that exists at the repo root today:

| Path | Role |
| --- | --- |
| `package.json` | Root manifest: prompt-burn, private, pnpm 11.24, node >= 24. No deps/scripts. |
| `pnpm-workspace.yaml` | Declares globs `packages/*`, `apps/*`. Neither directory exists yet. |
| `tsconfig.base.json` | Shared compiler options every future package config will extend. |
| `tsconfig.json` | Root config extending `tsconfig.base.json` with `files: []`. |
| `.nvmrc` | Pins Node major version `24`. |
| `.gitignore` | Ignores `node_modules/`, `dist/`, `*.tsbuildinfo`, `.DS_Store`, `.env*`, `out/`. |
| `README.md` | Product summary plus three doc links (product, plan, spec). |
| `pnpm-lock.yaml` | Lockfile, present but effectively empty — the root has no dependencies. |
| `docs/` | `product.md`, `implementation-plan.md`, `spec.md`, `data-shapes.md`, `fixtures/`. |
| `scripts/spike/dump-shapes.mjs` | Zero-dependency spike script from the shape investigation. |
| `AGENTS.md`, `CLAUDE.md` | Agent-facing repo notes (Paper design target). |

What does **not** exist yet: no `packages/` directory, no `apps/` directory, no `src/` anywhere, no
test suite, no CI config, no prettier (or other formatter) config. `docs/implementation-plan.md`
line 81 says explicitly: *"Do not scaffold empty packages in the first commit. Add a package when
its first real commit lands."* The planned future layout (lines 83–94) is `packages/core`,
`packages/db`, `packages/collectors`, `packages/ui`, `apps/desktop`, `apps/vscode` — each created
only when its first real commit lands.

## 3. Public surface

The scaffold's "public surface" is what the next contributor touches, and what every future package
must inherit:

- **Workspace globs** — `pnpm-workspace.yaml` recognizes any package under `packages/*` or
  `apps/*`. Creating `packages/core/` with a `package.json` is sufficient to join the workspace;
  nothing in the root needs editing.
- **TypeScript baseline** — `tsconfig.base.json` is the single source of truth for compiler
  behavior: `target`/`lib` ES2022, `module`/`moduleResolution` NodeNext, `strict: true`,
  `noUncheckedIndexedAccess: true`, `declaration`/`declarationMap`/`sourceMap` (with `noEmit: true`,
  so declarations serve consumers like editors rather than build output), `esModuleInterop`,
  `forceConsistentCasingInFileNames`, `skipLibCheck`. Future package configs must `extends` this
  file and add their own `include`/`references`; they must not relax the strictness flags locally.
- **Node version** — `.nvmrc` = 24 and `engines.node >= 24` agree; collectors will assume a modern
  Node runtime.
- **Package manager** — `packageManager: pnpm@11.24.0` pins the manager (corepack picks it up);
  the lockfile at the root governs all workspace members.
- **Git hygiene** — `.gitignore` keeps build output (`dist/`, `out/`, `*.tsbuildinfo`), secrets
  (`.env*`), and `node_modules/` out of history.

Nothing else is published or imported by anything; the repo exports no code.

## 4. Flow

There is no runtime flow yet. The only executable artifact is the spike:

1. `scripts/spike/dump-shapes.mjs` reads real OMP session JSONL and calls the Cursor usage API and
   writes shape dumps to a directory given as an argument (unredacted — see § 9).
2. Its findings are recorded in `docs/data-shapes.md` and three fixtures landed in
   `docs/fixtures/`; per `docs/implementation-plan.md` line 189 the spike is **blocking** — the
   domain types (commit 4) freeze against those fixtures.

The planned flow once packages exist: collectors under `packages/collectors/` read OMP/Cursor
sources and emit usage events; `packages/db/` persists them; `packages/core/` holds domain types;
`packages/ui/` + `apps/desktop/` render the dashboard; `apps/vscode/` is a secondary shell. None of
this exists — [INFERENCE] this ordering comes from the plan's package list and Phase table, not
from code.

## 5. Contracts and invariants

- **Empty root typecheck is intentional.** `tsconfig.json` has `files: []` — a root invocation of
  `tsc -p .` checks nothing. This mirrors the plan's review focus for the scaffold commit ("Empty
  workspace still passes", line 187): adding packages must never break a root typecheck; each
  package owns its own tsconfig that extends `tsconfig.base.json`.
- **Strictness is workspace-wide and non-negotiable.** Every package inherits
  `noUncheckedIndexedAccess` and `strict`; indexed access returns `T | undefined` by default and
  code must narrow rather than cast.
- **NodeNext everywhere.** Module resolution matches Node's runtime behavior; package `exports`
  maps and `.js` extension specifiers in ESM imports are required.
- **No emitted output.** `noEmit: true` — the plan builds apps with bundlers/runtime loaders, not
  `tsc` output; declaration files exist for editor and cross-package typechecking only.
- **Spike before types.** `docs/implementation-plan.md` line 189: do not start commit 4 (domain
  types) until fixtures are on disk. If Cursor Pro returns no per-model tokens, stop and revisit.
- **Node 24 minimum.** `.nvmrc` and `engines` must stay in agreement; a mismatch silently lets one
  of the two controls win.

## 6. Configuration

Current knobs, all at the root:

- `package.json` — `packageManager` pins pnpm; `engines.node` pins the floor. No scripts yet
  (see § 9).
- `pnpm-workspace.yaml` — the two globs. Adding a new top-level directory family means editing
  this file; adding a package within `packages/` or `apps/` does not.
- `tsconfig.base.json` — the compiler contract (§ 3). Changes here propagate to every future
  package; treat edits as breaking for all members.
- `.nvmrc` — consumed by `nvm`/devcontainer-style tooling.
- `.gitignore` — the deny-list above. Note `out/` is ignored but nothing writes it yet; `dist/`
  is the planned build-output convention.

There is no environment configuration, no feature flags, no runtime settings at all — the
dashboard does not run.

## 7. Boundaries and dependencies

- **Runtime dependencies: zero.** The root has no dependencies; `pnpm-lock.yaml` exists but is
  trivial. The spike script is deliberately zero-dependency (68 lines of plain `.mjs`).
- **Upstream inputs:** OMP session transcripts under `~/.omp/agent/sessions/` and Cursor's local
  database plus usage API — but only as *documented* shapes in `docs/data-shapes.md`; no code in
  the repo touches either yet.
- **The workspace boundary is the tooling boundary:** anything under `packages/*` or `apps/*`
  shares the base tsconfig and lockfile; anything outside (docs, spike scripts, agent notes) is
  unconstrained by workspace tooling.
- **No CI, no formatter, no linter.** Style enforcement is currently human review plus the plan's
  commit-by-commit structure. This is a real boundary: nothing automated guards the invariants in
  § 5 yet.

## 8. Tests

There are no tests. No test framework is installed, no test script exists, and no CI runs anything.
What *is* verified today:

- The spike's observations are pinned as JSON fixtures in `docs/fixtures/` and narrated in
  `docs/data-shapes.md` — the closest thing to executable expectations, and they are static data,
  not assertions.

What is **not** covered — stated plainly:

- Nothing typechecks. Root `tsconfig.json` checks zero files.
- Nothing runs the plan's intended `pnpm test` / `pnpm typecheck` — those scripts are planned for
  Phase 0 commit 3 (`docs/implementation-plan.md` line 187) but do not exist at HEAD.
- No test would catch a regression to `tsconfig.base.json` strictness flags, a workspace glob
  typo, or an engines/.nvmrc mismatch.

## 9. Debt and traps

Deliberately blunt:

- **`files: []` means nothing typechecks.** Until the first package appears, the entire TypeScript
  contract is unenforced. A strictness flag deleted from `tsconfig.base.json` today would be
  caught by no tool — review only. Acceptable while the workspace is empty; becomes a trap the
  moment packages land without their own tsconfigs (the plan's commit 3 scripts are the intended
  fix).
- **Planned scripts do not exist.** Phase 0 commit 3 plans root `pnpm test` / `pnpm typecheck` with
  review focus "Empty workspace still passes" — neither script is present at HEAD. The scaffold
  commit and the scripts commit are separable, but until commit 3 lands, every commit after it
  violates the plan's "each commit should typecheck" rule (line 3) in spirit.
- **No formatter, no linter, no CI.** Formatting and lint decisions will be made ad hoc per commit
  until configured. The plan says CI "later if wanted"; nobody has wanted yet.
- **The spike writes unredacted dumps.** `scripts/spike/dump-shapes.mjs` writes raw API/session
  output to a given directory when run with an argument. The plan's commit-2 row says fixtures
  should be redacted; the fixtures in `docs/fixtures/` are committed, but running the script again
  with a careless output path risks writing live token data to a non-ignored directory. `out/` is
  gitignored — use it, or nothing.
- **Workspace globs accept empty directories silently.** A stray `packages/foo/` without a
  `package.json` is invisible to pnpm but visible to globbing tools; conversely a package created
  outside the two globs will be silently excluded from the workspace. No validation exists.
- **pnpm 11 / Node 24 are current-major choices.** Fine for greenfield; the lockfile pins pnpm's
  exact behavior, so `packageManager` drift between contributors will fail loudly (that part is
  good) — but Node minor drift within 24 is unpoliced.

## 10. Change guide

How this area can evolve, and what each change touches:

- **Adding the first package** (expected next): create `packages/<name>/` with its own
  `package.json` and a `tsconfig.json` extending `../..`/`tsconfig.base.json`. No root edits
  needed — the globs already cover it. The root `tsconfig.json` stays `files: []`.
- **Landing commit 3's scripts**: add `test`/`typecheck` scripts to root `package.json` that
  iterate workspace members (`pnpm -r`); keep the root typecheck passing with zero files.
- **Adding a compiler flag**: edit `tsconfig.base.json` only; package configs extend it and must
  not override strictness. Check that `noEmit` + `declaration` stays coherent (it affects editors
  and cross-package checks, not builds).
- **Changing Node version**: update `.nvmrc` and `engines.node` in the same commit; they must agree.
- **Adding a directory family** (e.g. `tools/*`): edit `pnpm-workspace.yaml`; update `.gitignore`
  if the family produces build output.
- **Deleting the spike**: once domain types and fixtures land (commit 4+),
  `scripts/spike/dump-shapes.mjs` is removable; keep `docs/data-shapes.md` and the fixtures as the
  durable record.