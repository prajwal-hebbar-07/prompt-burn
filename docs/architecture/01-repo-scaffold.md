# Repo scaffold and workspace tooling

> **Plain English:** [The workshop](../plain-english/01-the-workshop.md).

## 1. Purpose

This repository is a pnpm workspace for **prompt-burn**, a local dashboard that reads OMP and Cursor
token usage and prices it at estimated pay-as-you-go rates. The workspace is no longer empty: at the
current HEAD (`325b156`) the scaffold has been joined by three packages (`packages/core`,
`packages/db`, `packages/collectors`) and a desktop app (`apps/desktop`, a Tauri v2 shell with a
Node sidecar). This document records the root scaffold — the shared configuration every member
inherits and the recursive typecheck/test contract that binds them — as it stands today. The
internals of the four members are out of scope here; they are documented by their own pairs,
numbers 04–07.

Sources: root `README.md`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
`tsconfig.json`, `.nvmrc`, `.gitignore`, `pnpm-lock.yaml`, and each member's `package.json`.

## 2. Inventory

Everything at the repo root, plus the workspace members it now governs:

| Path                            | Role                                                                                                                                             |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `package.json`                  | Root manifest: prompt-burn, private, pnpm 11.24, node >= 24. Dev-dependency `typescript ^7.0.2`; scripts `typecheck` and `test` (§ 3).           |
| `pnpm-workspace.yaml`           | Declares globs `packages/*`, `apps/*`. Both directories now exist and are populated.                                                             |
| `tsconfig.base.json`            | Shared compiler options every member's tsconfig extends.                                                                                         |
| `tsconfig.json`                 | Root config extending `tsconfig.base.json` with `files: []`.                                                                                     |
| `.nvmrc`                        | Pins Node major version `24`.                                                                                                                    |
| `.gitignore`                    | Ignores `node_modules/`, `dist/`, `*.tsbuildinfo`, `.DS_Store`, `.env*`, `out/`, plus `target/` and `src-tauri/gen/` (Tauri/Cargo build output). |
| `README.md`                     | Product summary plus doc links (product, plan).                                                                                                  |
| `pnpm-lock.yaml`                | Lockfile, now substantial (~1,100 lines): `typescript`, `vitest`, and `@tauri-apps/cli` resolved across the workspace members.                   |
| `docs/`                         | `product.md`, `implementation-plan.md`, `spec.md`, `data-shapes.md`, `fixtures/`, plus the architecture and plain-english docs.                  |
| `scripts/spike/dump-shapes.mjs` | Zero-dependency spike script from the shape investigation.                                                                                       |
| `AGENTS.md`, `CLAUDE.md`        | Agent-facing repo notes (Paper design target).                                                                                                   |
| `packages/core`                 | Domain types package — documented in pair 04.                                                                                                    |
| `packages/db`                   | Persistence package — documented in pair 05.                                                                                                     |
| `packages/collectors`           | Source-reading package — documented in pair 06.                                                                                                  |
| `apps/desktop`                  | Tauri v2 shell with a Node sidecar — documented in pair 07.                                                                                      |

Still absent: no `packages/ui`, no `apps/vscode` (planned but not yet created), no CI config, no
prettier (or other formatter) config. The plan's rule — add a package only when its first real
commit lands — still governs what exists.

## 3. Public surface

The root's "public surface" is what every workspace member touches and must conform to:

- **Workspace globs** — `pnpm-workspace.yaml` recognizes any package under `packages/*` or
  `apps/*`. Creating a directory there with a `package.json` is sufficient to join the workspace;
  nothing in the root needs editing. All four current members joined exactly this way.
- **TypeScript baseline** — `tsconfig.base.json` is the single source of truth for compiler
  behavior: `target`/`lib` ES2022, `module`/`moduleResolution` NodeNext, `strict: true`,
  `noUncheckedIndexedAccess: true`, `declaration`/`declarationMap`/`sourceMap` (with `noEmit: true`,
  so declarations serve consumers like editors rather than build output), `esModuleInterop`,
  `forceConsistentCasingInFileNames`, `skipLibCheck`. Every member's tsconfig `extends` this file
  (verified in all four) and must not relax the strictness flags locally.
- **Recursive check contract** — root `typecheck` is `tsc -p . && pnpm -r --if-present typecheck`;
  root `test` is `pnpm -r --if-present test`. Every member defines both scripts (all four do:
  `tsc -p .` and `vitest run`), so the recursion currently reaches everything. A new member without
  a `typecheck` or `test` script is silently skipped by `--if-present` — the contract is
  conventional, not enforced.
- **Node version** — `.nvmrc` = 24 and `engines.node >= 24` agree.
- **Package manager** — `packageManager: pnpm@11.24.0` pins the manager (corepack picks it up);
  the root lockfile governs all workspace members.
- **Git hygiene** — `.gitignore` keeps build output (`dist/`, `out/`, `*.tsbuildinfo`, and now
  Tauri/Cargo's `target/` and `src-tauri/gen/`), secrets (`.env*`), and `node_modules/` out of
  history.

The root itself publishes nothing importable; all shared code lives in the packages (pair 04–06
territory).

## 4. Flow

There is still no product runtime flow at the root — nothing here starts the dashboard. What runs
from the root is the check pipeline:

1. `pnpm typecheck` runs `tsc -p .` against the root config, which compiles zero files (a bare
   check, § 5), then recurses into every workspace member with a `typecheck` script.
2. `pnpm test` recurses into every member with a `test` script; each of the four runs vitest, and
   the desktop member's suite includes a test that spawns its sidecar as a real child process (§ 8,
   details in pair 07).

The product flow — collectors read OMP/Cursor sources, `db` persists, `core` types it, the desktop
app renders — now exists in outline across the members, but its description belongs to pairs
04–07, not here. The spike (`scripts/spike/dump-shapes.mjs`) remains the only root-level
executable artifact; its findings are pinned in `docs/data-shapes.md` and `docs/fixtures/`.

## 5. Contracts and invariants

- **The root typecheck is a bare compile check, by design.** `tsconfig.json` has `files: []`, so
  `tsc -p .` at the root compiles zero files. It is no longer "checks nothing at all" in spirit —
  it validates the root config itself and anchors the recursive chain — but it enforces no code.
  Each member owns its own tsconfig extending `tsconfig.base.json`, and their scripts do the real
  checking.
- **Strictness is workspace-wide and non-negotiable.** Every member inherits
  `noUncheckedIndexedAccess` and `strict`; indexed access returns `T | undefined` by default and
  code must narrow rather than cast.
- **NodeNext everywhere.** Module resolution matches Node's runtime behavior; package `exports`
  maps and `.js` extension specifiers in ESM imports are required.
- **No emitted output.** `noEmit: true` — apps build with bundlers/runtime loaders, not `tsc`
  output; declaration files exist for editor and cross-package typechecking only.
- **Every member must satisfy the recursive contract.** `--if-present` makes omission silent, so
  the invariant "a member without typecheck/test scripts is a gap" is maintained by convention and
  review.
- **Node 24 minimum.** `.nvmrc` and `engines` must stay in agreement; a mismatch silently lets one
  of the two controls win.

## 6. Configuration

Current knobs, all at the root:

- `package.json` — `packageManager` pins pnpm; `engines.node` pins the floor; the two scripts
  define the recursive check contract (§ 3); `typescript` as the sole root dev-dependency puts
  `tsc` on every workspace member's PATH.
- `pnpm-workspace.yaml` — the two globs. Adding a new top-level directory family means editing
  this file; adding a package within `packages/` or `apps/` does not.
- `tsconfig.base.json` — the compiler contract (§ 3). Changes here propagate to every member;
  treat edits as breaking for all members.
- `.nvmrc` — consumed by `nvm`/devcontainer-style tooling.
- `.gitignore` — the deny-list above. `out/` is still ignored but nothing at the root writes it;
  `dist/` remains the build-output convention. `target/` and `src-tauri/gen/` were added when the
  Tauri app landed.

There is still no environment configuration, no feature flags, no runtime settings at the root.

## 7. Boundaries and dependencies

- **Runtime dependencies: zero at the root.** The root's only dependency is the `typescript`
  dev-dependency; the lockfile is substantial because the members resolved `vitest`,
  `@tauri-apps/cli`, and friends. The spike script remains deliberately zero-dependency.
- **Upstream inputs:** OMP session transcripts under `~/.omp/agent/sessions/` and Cursor's local
  database plus usage API. The members now read some of these — see pairs 06 and 07; the shapes
  contract lives in `docs/data-shapes.md`.
- **The workspace boundary is the tooling boundary:** anything under `packages/*` or `apps/*`
  shares the base tsconfig, the lockfile, and the recursive scripts; anything outside (docs, spike
  scripts, agent notes) is unconstrained by workspace tooling.
- **The Tauri app drags in a second toolchain.** `apps/desktop` contains a Rust crate (`Cargo.toml`,
  `src-tauri/`); building it requires a Rust toolchain that pnpm does not manage, and its build
  output (`target/`, `src-tauri/gen/`) is gitignored at the root.
- **No CI, no formatter, no linter.** Style enforcement is still human review plus the plan's
  commit-by-commit structure. Nothing automated guards the invariants in § 5 yet.

## 8. Tests

The test arrangement is now real, though still lean:

- `pnpm test` at the root is `pnpm -r --if-present test`: it runs each workspace member's `test`
  script in dependency order. All four members define one; each is a vitest run (`vitest run`).
- `packages/core`, `packages/db`, and `packages/collectors` run unit suites over their sources
  (counts and coverage are their pairs' business).
- `apps/desktop`'s vitest run includes a sidecar spawn test: it launches `sidecar/index.ts` as a
  child Node process with a temporary HOME, reads the sidecar's JSON ready line from stdout, asserts
  the database file exists with tables applied, closes the sidecar's stdin, and asserts a clean
  exit. The real `~/.prompt-burn/db.sqlite` is never touched.
- `pnpm typecheck` at the root compiles zero files itself, then typechecks every member.

What is **not** covered — stated plainly:

- The root tsconfig checks no code; a file that belongs to no member's tsconfig is typechecked by
  nothing.
- No CI runs any of this; it happens only when a human invokes it locally.
- No test guards the tooling itself: a deleted strictness flag, a workspace glob typo, an
  engines/.nvmrc mismatch, or a member missing its scripts would be caught by review, not by a
  test.

## 9. Debt and traps

Deliberately blunt:

- **`--if-present` makes omission silent.** The recursive typecheck/test contract is only as strong
  as each member's scripts. A new package that lands without a `test` script is skipped by `pnpm
test` with no warning; nothing validates that the contract is satisfied. All four current members
  comply — this is a trap for the fifth.
- **The root `tsc -p .` compiles zero files.** A strictness flag deleted from `tsconfig.base.json`
  today would surface only as missing strictness in members that extend it — fewer errors, not
  new ones — so it can pass review unnoticed. The per-member tsconfigs do the enforcement; the
  root's role is ceremonial.
- **No formatter, no linter, no CI.** Formatting and lint decisions are still made ad hoc per
  commit. The plan says CI "later if wanted"; nobody has wanted yet.
- **The spike writes unredacted dumps.** `scripts/spike/dump-shapes.mjs` writes raw API/session
  output to a given directory when run with an argument. The committed fixtures are redacted, but
  running the script again with a careless output path risks writing live token data to a
  non-ignored directory. `out/` is gitignored — use it, or nothing.
- **Workspace globs accept empty directories silently.** A stray `packages/foo/` without a
  `package.json` is invisible to pnpm but visible to globbing tools; conversely a package created
  outside the two globs is silently excluded from the workspace — and, being outside, also from
  the recursive scripts. No validation exists.
- **The desktop member needs a Rust toolchain pnpm cannot install.** A fresh machine with Node and
  pnpm can run every package's checks but not `tauri build` until Rust is present. The gitignore
  entries for `target/` and `src-tauri/gen/` are already waiting for it.
- **pnpm 11 / Node 24 / TypeScript 7 are current-major choices.** Fine for greenfield; the lockfile
  pins pnpm's exact behavior, so `packageManager` drift between contributors fails loudly — but
  Node minor drift within 24 is unpoliced.

## 10. Change guide

How this area can evolve, and what each change touches:

- **Adding the next member** (e.g. `packages/ui`, `apps/vscode`): create the directory with its own
  `package.json` and a `tsconfig.json` extending the base config. No root edits needed — the globs
  already cover it — but it **must** define `typecheck` and `test` scripts or the recursive
  commands skip it silently (§ 9). The root `tsconfig.json` stays `files: []`.
- **Adding a compiler flag**: edit `tsconfig.base.json` only; member configs extend it and must not
  override strictness. Check that `noEmit` + `declaration` stays coherent (it affects editors and
  cross-package checks, not builds).
- **Changing Node version**: update `.nvmrc` and `engines.node` in the same commit; they must agree.
- **Adding a directory family** (e.g. `tools/*`): edit `pnpm-workspace.yaml`; update `.gitignore`
  if the family produces build output.
- **Adding a formatter or CI**: new top-level config plus (for CI) a workflow that runs
  `pnpm typecheck && pnpm test` — the recursive scripts are already CI-shaped.
- **Deleting the spike**: the fixtures and `docs/data-shapes.md` are the durable record and have
  already served their purpose (the domain types exist); `scripts/spike/dump-shapes.mjs` is now
  removable whenever the next sweep wants it gone.
