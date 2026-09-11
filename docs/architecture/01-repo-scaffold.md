# Repo scaffold and workspace tooling

> **Plain English:** [The workshop](../plain-english/01-the-workshop.md).

## 1. Purpose

This repository is a pnpm workspace for **prompt-burn**, a local dashboard that reads OMP, Cursor,
Claude Code, Antigravity, and Ollama token usage and prices it at estimated pay-as-you-go rates. The
workspace holds seven members: five packages (`packages/core`, `packages/db`, `packages/collectors`,
`packages/reader`, `packages/ui`) and two applications (`apps/desktop`, a Tauri v2 native shell with
a Node sidecar; `apps/vscode`, a VS Code editor-tab extension hosting the dashboard webview). This
document records the root scaffold — the shared configuration every member inherits, the root
scripts, the five-surface version contract, and the CI and release pipelines — as it stands at HEAD
(`9a88364`). The internals of the seven members are out of scope here; they are documented by their
own pairs, numbers 04–10.

Sources: root `README.md`, `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`,
`tsconfig.json`, `.nvmrc`, `.gitignore`, `pnpm-lock.yaml`, `.github/workflows/ci.yml`,
`.github/workflows/release.yml`, `scripts/bump-version.mjs`, `scripts/bump-version.test.mjs`,
`docs/release.md`, and each member's manifest.

## 2. Inventory

Everything at the repo root and under root-level scripts, plus the workspace members governed:

| Path | Role |
| --- | --- |
| `package.json` | Root manifest: v1.1.0, private, pnpm 11.24, node >= 24 (§ 3). |
| `pnpm-workspace.yaml` | Declares globs `packages/*` and `apps/*` for 5 packages and 2 apps. |
| `tsconfig.base.json` | Shared compiler options extended by every member's tsconfig. |
| `tsconfig.json` | Root config extending `tsconfig.base.json` with `files: []`. |
| `.nvmrc` | Pins Node major version `24`. |
| `.gitignore` | Denies `node_modules/`, `dist/`, `target/`, `sidecar-dist/`, etc. |
| `README.md` | Product summary plus links to `docs/product.md` and plans. |
| `pnpm-lock.yaml` | Lockfile resolving dependencies across all 7 workspace members. |
| `.github/workflows/ci.yml` | CI workflow running `pnpm typecheck` and `pnpm test` on PR/push. |
| `.github/workflows/release.yml` | Multi-OS build and release workflow (`workflow_dispatch`). |
| `scripts/bump-version.mjs` | Syncs version across 5 surfaces, or checks with `--check`. |
| `scripts/bump-version.test.mjs` | Tests (`node --test`) for version calculation and rewriting. |
| `scripts/spike/dump-shapes.mjs` | Zero-dependency spike script for inspecting token data (§ 4). |
| `docs/` | Plans, specs, data shapes, fixtures, `release.md`, and twin docs. |
| `AGENTS.md`, `CLAUDE.md` | Agent-facing repo notes (Paper design target). |
| `packages/core` | Domain types, period filtering, aggregation (pair 04). |
| `packages/db` | SQLite persistence at `~/.prompt-burn/db.sqlite` (pair 05). |
| `packages/collectors` | Ingestion from OMP, Claude, Cursor, Antigravity, Ollama (pair 06). |
| `packages/reader` | Shared `UsageReader` orchestrating collectors and DB (pair 09). |
| `packages/ui` | Shared React + Tailwind presentation components (pair 08). |
| `apps/desktop` | Tauri v2 native shell with Node sidecar (pair 07). |
| `apps/vscode` | VS Code editor-tab extension hosting webview dashboard (pair 10). |

Still absent: no Prettier, ESLint, or other formatting/linting configuration at the root. Code
style and formatting remain governed by review rather than automated tooling.

## 3. Public surface

The root's public surface is what every workspace member touches and must conform to:

- **Workspace globs** — `pnpm-workspace.yaml` recognizes any package under `packages/*` or
  `apps/*`. Creating a directory there with a `package.json` joins the workspace automatically.
  All seven current members joined this way.
- **TypeScript baseline** — `tsconfig.base.json` is the single source of truth for compiler
  behavior: `target`/`lib` ES2022, `module`/`moduleResolution` NodeNext, `strict: true`,
  `noUncheckedIndexedAccess: true`, `declaration`/`declarationMap`/`sourceMap`, `noEmit: true`
  (bundlers and loaders produce executable output), `esModuleInterop`,
  `forceConsistentCasingInFileNames`, and `skipLibCheck`. Every member extends this file and must
  not relax strictness locally.
- **Root scripts & check pipeline**:
  - `dev`: `pnpm --filter @prompt-burn/desktop exec tauri dev` launches the Tauri desktop shell in
    development mode.
  - `typecheck`: `tsc -p . && pnpm -r --if-present typecheck` runs the root bare compile check,
    then recurses into every workspace member.
  - `test`: `node --test scripts/*.test.mjs && pnpm -r --if-present test` runs Node's built-in
    test runner over root script tests, then recurses into every member's test script.
  - `bump`: `node scripts/bump-version.mjs` updates versions across all release surfaces.
  - `version:check`: `node scripts/bump-version.mjs --check` verifies that all release surfaces
    agree.
- **Single version of truth across release surfaces** — Root `package.json` owns the public
  version number (`1.1.0`). `scripts/bump-version.mjs` synchronizes this version across five
  surfaces:
  1. `package.json`
  2. `apps/vscode/package.json`
  3. `apps/desktop/package.json`
  4. `apps/desktop/src-tauri/tauri.conf.json`
  5. `apps/desktop/src-tauri/Cargo.toml` (under `[package]` only)
  Internal packages under `packages/` stay at `0.0.0` as private `workspace:*` dependencies.
- **Node version** — `.nvmrc` = 24 and `engines.node >= 24` agree.
- **Package manager** — `packageManager: pnpm@11.24.0` pins the manager; the root lockfile governs
  all workspace members.
- **Git hygiene** — `.gitignore` keeps dependencies (`node_modules/`), build outputs (`dist/`,
  `out/`, `*.tsbuildinfo`, `target/`, `src-tauri/gen/`, `sidecar-dist/`), environment secrets
  (`.env*`), and private local docs (`docs/twitter-campaign.md`) out of git history.
- **CI / release automation** — `.github/workflows/ci.yml` enforces typechecking and tests on
  pushes and pull requests. `.github/workflows/release.yml` automates cross-platform builds and
  publishing.

The root itself publishes nothing importable; all shared logic lives in `packages/`.

## 4. Flow

Root-level flow encompasses daily development, the verification pipeline, versioning, and
release:

1. **Development**: Running `pnpm dev` filters execution to `@prompt-burn/desktop` to invoke `tauri
   dev`, which runs the desktop webview dev server alongside the Tauri application.
2. **Typechecking**: `pnpm typecheck` runs `tsc -p .` against the root config (which compiles zero
   files, validating the root configuration itself), then recurses across all seven workspace
   members with `--if-present`. In `apps/vscode`, the member's `typecheck` script runs both `tsc -p
   . --noEmit` (extension host) and `tsc -p tsconfig.web.json` (webview).
3. **Testing**: `pnpm test` first runs `node --test scripts/*.test.mjs`, executing unit tests for
   `scripts/bump-version.mjs`. It then recurses across all seven members using `pnpm -r
   --if-present test`. Each member runs Vitest (`vitest run`). In `apps/desktop`, the suite
   includes spawning the sidecar process in isolation with a temporary HOME.
4. **Versioning**: `pnpm bump <patch|minor|major|X.Y.Z>` parses the current version from
   `package.json`, calculates the next semver version, and updates all five release surfaces in
   place. `pnpm version:check` ensures no surface has drifted.
5. **Continuous Integration**: On pushes to `main` and pull requests, GitHub Actions executes
   `ci.yml` on `ubuntu-latest`. It installs dependencies with `--frozen-lockfile` on Node 24 and
   runs `pnpm typecheck` and `pnpm test`.
6. **Release Automation**: Triggered via `workflow_dispatch` on `release.yml`, a release runs four
   jobs: `prepare` (runs checks and computes version), `desktop` (builds macOS universal DMG, Linux
   deb/rpm/AppImage, and Windows MSI/NSIS in parallel), `vscode` (builds host/web bundles and
   packages `Prompt-Burn-X.Y.Z.vsix` via vsce), and `publish` (commits version bump, tags `vX.Y.Z`,
   pushes to git, and uploads all artifacts to GitHub Releases). If any build fails, nothing is
   committed or tagged.

The spike script (`scripts/spike/dump-shapes.mjs`) remains an executable utility to re-inspect live
OMP and Cursor inputs on demand.

## 5. Contracts and invariants

- **Root typecheck is a bare compile check:** `tsconfig.json` has `files: []`, so `tsc -p .`
  compiles zero files. It validates the root config file and anchors the recursive check, but
  enforces no code directly. Root `.mjs` scripts are plain ESM and are not typechecked by `tsc`.
- **Strictness is workspace-wide and non-negotiable:** Every member inherits `strict: true` and
  `noUncheckedIndexedAccess: true`. Indexed property lookups return `T | undefined` by default.
- **NodeNext everywhere:** ESM imports with explicit extensions or package `exports` maps are
  mandated across all members.
- **No emitted output from tsc:** `noEmit: true` is set in `tsconfig.base.json`. Bundlers (Vite,
  Tauri CLI, VSCE) generate build outputs, not `tsc`.
- **Single version of truth:** The `version` in root `package.json` is the sole source of truth for
  releases. All five release surfaces must match exactly. Workspace packages under `packages/`
  remain `0.0.0` and are consumed via `workspace:*`.
- **Atomic releases:** No git tag or release commit is created if any platform build in
  `release.yml` fails. Releases are created only from GitHub Actions, never directly from a local
  machine.
- **Recursive check contract:** Every workspace member is expected to supply `typecheck` and
  `test` scripts. Although `--if-present` skips members lacking these scripts without error, all
  seven current members provide them.
- **Node 24 minimum:** `.nvmrc`, `package.json` engines, CI runners, and release scripts enforce
  Node >= 24 (required for features like `node:sqlite` in sidecars and `node --test`).

## 6. Configuration

Current knobs at the root:

- `package.json` — `packageManager` pins pnpm 11.24.0; `engines.node` pins Node >= 24; scripts
  define the dev, typecheck, test, bump, and version verification entrypoints; `typescript`
  dev-dependency puts `tsc` on PATH for all members.
- `pnpm-workspace.yaml` — Defines workspace globs `packages/*` and `apps/*`.
- `tsconfig.base.json` — The TypeScript compiler contract extended by all members.
- `tsconfig.json` — Extends base config with `files: []`.
- `.nvmrc` — Pins Node major version `24`.
- `.gitignore` — Denies build output (`dist/`, `out/`, `*.tsbuildinfo`, `target/`,
  `src-tauri/gen/`, `sidecar-dist/`), secrets (`.env*`), dependencies (`node_modules/`), and
  private local docs (`docs/twitter-campaign.md`).
- `.github/workflows/ci.yml` — Runs checks on Ubuntu with Node 24 and pnpm caching.
- `.github/workflows/release.yml` — Orchestrates multi-platform release matrix, bundle packaging,
  git tagging, and GitHub release publishing.
- `scripts/bump-version.mjs` — Defines the `surfaces` array mapping the five files that track public
  semver versions.

## 7. Boundaries and dependencies

- **Runtime dependencies:** Zero at the repo root. DevDependencies at root contain only `typescript
  ^7.0.2`. Root scripts rely exclusively on built-in Node 24 modules (`node:fs`, `node:path`,
  `node:url`, `node:test`, `node:assert/strict`, `node:os`).
- **Workspace lockfile:** `pnpm-lock.yaml` resolves third-party dependencies used by packages and
  apps (React 19, Vitest, Tauri CLI, Tailwind CSS, etc.).
- **Multiple toolchains:**
  - Node 24 / pnpm 11.24.0 for JavaScript and TypeScript tooling.
  - Rust toolchain (Rust >= 1.77.2, `Cargo.toml`) for `apps/desktop` native Tauri compilation.
  - VS Code extension packaging (`@vscode/vsce`) for packaging `apps/vscode` into a VSIX bundle.
  - Native Linux build dependencies (`libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, etc.)
    required when building the Tauri desktop application on Ubuntu.
- **Workspace boundaries:** Anything in `packages/*` and `apps/*` shares the base tsconfig,
  lockfile, and recursive scripts. Scripts and docs outside these globs are unconstrained by member
  tooling.
- **CI / release boundaries:** Automated verification runs in GitHub Actions. All official releases
  are built in CI across macOS, Linux, and Windows runners, preventing environment drift from local
  developer machines.
- **No formatter or linter:** Neither Prettier nor ESLint is installed or configured at the root.

## 8. Tests

The repository's test arrangement spans root scripts, workspace packages, and automated CI:

- `pnpm test` at the root executes two stages:
  1. `node --test scripts/*.test.mjs`: Runs Node's built-in test runner over
     `scripts/bump-version.test.mjs`. Verifies semver increment calculations (`major`, `minor`,
     `patch`, explicit strings), TOML section isolation in `Cargo.toml` (ensuring dependency
     versions like `tauri = { version = "2" }` are not overwritten), and synchronized multi-surface
     rewriting.
  2. `pnpm -r --if-present test`: Recurses into all seven workspace members in dependency order.
     Each member runs `vitest run`:
     - `packages/core`: Tests domain types, period calculation, model ID normalization, token
       aggregation.
     - `packages/db`: Tests SQLite schema creation, events table, pricing lookups, settings storage.
     - `packages/collectors`: Tests parsers for OMP, Claude Code, Cursor, Antigravity, Ollama, and
       sync.
     - `packages/reader`: Tests golden record fixtures and unified reader orchestration.
     - `packages/ui`: Component tests using Testing Library and JSDOM.
     - `apps/desktop`: Tests UI logic and sidecar process spawning/IPC in isolated temp
       environments.
     - `apps/vscode`: Tests host messaging, ID translation, reader integration, and webview UI.
- `pnpm typecheck` at the root compiles zero files itself, then recurses into all seven members
  (`tsc -p .`, plus `tsc -p tsconfig.web.json` in `apps/vscode`).
- `pnpm version:check` verifies that the five version surfaces in `package.json`,
  `apps/vscode/package.json`, `apps/desktop/package.json`, `apps/desktop/src-tauri/tauri.conf.json`,
  and `apps/desktop/src-tauri/Cargo.toml` share identical version strings.
- Continuous Integration in `.github/workflows/ci.yml` runs `pnpm typecheck` and `pnpm test` on
  every pull request and commit to `main`.

What is **not** covered — stated plainly:

- The root `.mjs` scripts (`scripts/bump-version.mjs`, `scripts/spike/dump-shapes.mjs`) are not
  typechecked by TypeScript.
- `scripts/spike/dump-shapes.mjs` has no automated tests.
- `pnpm version:check` is not executed in `pnpm test` or `ci.yml`; version drift is caught only
  during release runs (`release.yml`) or manual script invocation.
- Release artifacts (DMG, AppImage, MSI, VSIX) are not generated or tested during pull request CI.
- No automated test guards against deleted strictness flags in `tsconfig.base.json` or enforces
  that new workspace members define `typecheck` and `test` scripts.
- No linter or formatter runs in CI or locally.

## 9. Debt and traps

Deliberately blunt:

- **`--if-present` makes omission silent:** The recursive test and typecheck pipeline skips any
  member without a `test` or `typecheck` script without warning. While all seven current members
  define both scripts, a newly added member omitting either script will be silently skipped.
- **Version drift can escape CI:** Root `package.json` owns the release version, but `ci.yml` only
  runs `pnpm typecheck` and `pnpm test`. It does not run `pnpm version:check`. If someone updates
  `package.json` by hand without running `pnpm bump`, CI stays green; the inconsistency is caught
  only when `release.yml` fails during a release run.
- **Root scripts are exempt from typechecking:** Root scripts are JavaScript ESM files, and
  `tsconfig.json` has `files: []`. Any syntax or runtime bug in `scripts/spike/dump-shapes.mjs` or
  untested paths in `scripts/bump-version.mjs` will escape compiler detection.
- **No formatter, no linter:** Formatting and linting decisions remain unautomated and ad hoc.
  Style inconsistencies can enter the codebase undetected.
- **Spike writes unredacted dumps:** `scripts/spike/dump-shapes.mjs` writes raw token usage data if
  passed an argument. While `out/` is gitignored, passing an unignored path risks committing live
  session data.
- **Cargo.toml regex parsing:** `scripts/bump-version.mjs` uses regular expressions bounded by
  `[package]` rather than a proper TOML AST parser. Unconventional whitespace or comments inside
  `Cargo.toml`'s package block could lead to replacement errors.
- **Desktop member requires external Rust toolchain:** Fresh developer environments with Node and
  pnpm cannot run `pnpm dev` or `tauri build` for `apps/desktop` without installing Rust and native
  build dependencies.
- **Workspace globs accept empty directories silently:** Empty directories under `packages/*` or
  `apps/*` are silently ignored by pnpm; packages created outside these globs are silently excluded
  from checks.

## 10. Change guide

How this area can evolve, and what each change touches:

- **Adding a new workspace member**: Create directory under `packages/` or `apps/` with its own
  `package.json` and a `tsconfig.json` extending `./tsconfig.base.json`. Define `typecheck` and
  `test` scripts immediately (§ 9). If the new member is a shippable application carrying a
  release version, add its manifest path to `surfaces` in `scripts/bump-version.mjs` and add
  corresponding build jobs in `.github/workflows/release.yml`.
- **Cutting a release or bumping versions**: Run `pnpm bump <patch|minor|major|X.Y.Z>` to
  synchronize all five release surfaces, followed by `pnpm version:check`. Trigger
  `.github/workflows/release.yml` via GitHub Actions `workflow_dispatch` (use `dry_run: true` to
  verify builds without publishing).
- **Adding a compiler flag**: Edit `tsconfig.base.json` only. Remember that changes propagate across
  all seven members; verify that strictness is not broken.
- **Changing Node version**: Update `.nvmrc`, `package.json` (`engines.node`),
  `.github/workflows/ci.yml`, and `.github/workflows/release.yml` simultaneously.
- **Adding root test suites**: Place tests in `scripts/*.test.mjs`. They run automatically as part
  of `pnpm test` via `node --test`.
- **Adding a formatter or linter**: Add config files at root (e.g. ESLint/Prettier/Biome), add root
  scripts, and add check steps to `.github/workflows/ci.yml`.
- **Retiring the spike**: Once no longer needed, `scripts/spike/dump-shapes.mjs` can be safely
  deleted; the durable record remains in `docs/data-shapes.md` and `docs/fixtures/`.
