# Releasing Prompt Burn

One version, one button. A release is a `workflow_dispatch` run of
[`.github/workflows/release.yml`](../.github/workflows/release.yml) — nothing is
released from a laptop.

## The version

The `version` field in the **root `package.json`** is the only version anyone
edits, and only through the script. `scripts/bump-version.mjs` copies it into
every other surface:

| File | Why it carries a version |
|------|--------------------------|
| `package.json` | The source of truth |
| `apps/vscode/package.json` | Stamped into the `.vsix` |
| `apps/desktop/package.json` | Keeps the desktop workspace honest |
| `apps/desktop/src-tauri/tauri.conf.json` | Stamped into the app bundle and the `.dmg` name |
| `apps/desktop/src-tauri/Cargo.toml` | `[package]` only — never the `tauri` dependency |

Packages under `packages/` stay at `0.0.0` on purpose: they are private and
consumed as `workspace:*`, so nothing ever reads those numbers.

```sh
pnpm version:check          # do the five files agree? exits non-zero on drift
pnpm bump patch             # 0.3.1 -> 0.3.2, rewrites all five, no git side effects
pnpm bump 1.0.0             # explicit version, same rewrite
```

The script never runs git. Tagging belongs to the workflow.

## Cutting a release

1. Land everything you want in the release on `main`. CI
   ([`ci.yml`](../.github/workflows/ci.yml)) must be green — the release run
   re-runs `pnpm typecheck` and `pnpm test` and refuses to tag a red tree.
2. GitHub → **Actions** → **Release** → **Run workflow** → pick `patch`,
   `minor`, or `major`. Tick **dry run** to build everything and publish
   nothing.
3. Wait. The run is four jobs:

| Job | What it does |
|-----|--------------|
| `prepare` | Runs `pnpm typecheck` and `pnpm test`, then computes `vX.Y.Z` from the bump you picked. Writes nothing back |
| `desktop` | Builds on macOS, Windows and Linux runners in parallel — universal binary on macOS — and uploads each platform's bundles |
| `vscode` | Packages `Prompt-Burn-X.Y.Z.vsix` and uploads it |
| `publish` | Applies the version, commits `chore(release): vX.Y.Z`, pushes the commit and the tag, then creates the Release with every artifact attached |

**Nothing is written to the repository until every build has passed.** The
version is stamped into each build job's own checkout so the artifacts carry the
right number, but those checkouts are thrown away; `publish` is the only job
that commits, tags or pushes, and it needs all three desktop platforms and the
extension to have succeeded. A failed build leaves no bump, no tag, and no
Release claiming a version that was never built.

A dry run stops after `desktop` and `vscode`. The bundles are still on the run's
**Artifacts** panel for a week — that is the way to test a build without burning
a version number.

## The artifacts

- **`Prompt-Burn-X.Y.Z.vsix`** — install with `code --install-extension
  Prompt-Burn-X.Y.Z.vsix`, or the Extensions view's *Install from VSIX…*. It is
  packaged with `--no-dependencies`: the host bundle produced by
  `vite.config.host.mts` already contains the `@prompt-burn/*` code, because
  those packages ship TypeScript sources that only resolve inside this checkout.
**Every desktop build needs Node 24 or newer on the machine.** The app's data layer is a Node
sidecar bundled into the app (`sidecar.mjs`) and run by the user's own Node — it uses
`node:sqlite`, which arrived in Node 22.5. Without Node the window still opens and says so
instead of dying. The app looks on `PATH`, then asks the user's shell (login *and* interactive,
so `.zshrc`-based nvm setups are seen), then reads the version-manager directories directly, and
it rejects any Node older than 24 — a Finder launch inherits none of that `PATH` itself.

- **`Prompt-Burn_X.Y.Z_universal.dmg`** — macOS, universal: one download for
  Apple Silicon and Intel. **Unsigned and unnotarised**, so macOS reports it as
  damaged after download. Clear the quarantine flag once, after copying the app
  to Applications: `xattr -dr com.apple.quarantine "/Applications/Prompt Burn.app"`.
- **`Prompt-Burn_X.Y.Z_x64_en-US.msi`** and **`Prompt-Burn_X.Y.Z_x64-setup.exe`** —
  Windows installers (MSI and NSIS). Unsigned, so SmartScreen shows *More info →
  Run anyway* on first install.
- **`prompt-burn_X.Y.Z_amd64.deb`**, **`prompt-burn-X.Y.Z-1.x86_64.rpm`**,
  **`prompt-burn_X.Y.Z_amd64.AppImage`** — Linux x86_64. The AppImage needs
  `chmod +x` and nothing else; the `.deb` and `.rpm` install the same binary.

Bundle names come from Tauri's `"targets": "all"`, which emits each platform's
native formats; the workflow only replaces the space Tauri puts in the file name,
because a space survives badly in a download URL. Only x86_64 Linux and Windows
are built — no arm64 Linux. Add a runner to the `desktop` matrix in
`release.yml` if that changes.

### App icons

`apps/desktop/src-tauri/icons/` is **not optional**: `tauri-build` refuses to
compile for Windows without `icons/icon.ico`, so a missing icon set fails the
release, not just the branding. What is in the repo today is a generated
placeholder — an amber flame on a near-black rounded square. Replace it with one
1024×1024 PNG and regenerate the whole set:

```sh
pnpm --filter @prompt-burn/desktop run tauri icon path/to/logo.png
```

Both shells share `~/.prompt-burn/db.sqlite`, so installing a new version never
loses data — the database lives outside both install locations.

## When a run fails

`publish` is the only job that writes anything, and it runs last, so almost
every failure needs no cleanup at all.

- **`prepare` failed** — the tree is red. Nothing was built or pushed. Fix
  `main`, run again with the same bump.
- **A `desktop` platform or `vscode` failed** — no tag, no commit, no Release:
  `publish` never started. Fix the build and re-run the whole workflow. Do not
  re-run only the failed job: `publish` requires every platform, by design, so a
  release never ships a missing installer.
- **`publish` failed after pushing** — the commit and tag are on `main` but the
  Release is missing or incomplete. Download the artifacts from the run and
  attach them by hand:

  ```sh
  gh release create vX.Y.Z --generate-notes --verify-tag dist/*
  ```

- **You need the version back** — the bump commit is an ordinary commit; revert
  it and delete the tag (`git push origin :refs/tags/vX.Y.Z`) plus the Release.
  Never hand-edit a version field to undo a bump; run `pnpm bump X.Y.Z` and let
  the script keep the five files together.

## Deliberately not automated

- Marketplace publishing (`vsce publish`) — this is a personal tool; the `.vsix`
  is the distribution.
- Code signing: no Apple Developer certificate (macOS is unsigned and
  unnotarised) and no Windows signing certificate (SmartScreen warns).
- Changelog curation. The Release notes are GitHub's generated commit list.
- Any release trigger other than a human clicking Run workflow.
