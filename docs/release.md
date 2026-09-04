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
   `minor`, or `major`.
3. Wait. The run does four things in order:

| Job | What it does |
|-----|--------------|
| `tag` | Checks, bumps, commits `chore(release): vX.Y.Z`, pushes the commit and an annotated `vX.Y.Z` tag |
| `release` | Creates the GitHub Release from that tag with generated notes |
| `vscode` | Builds and packages `prompt-burn-X.Y.Z.vsix`, attaches it |
| `desktop` | Builds the app on macOS, Windows and Linux runners in parallel, attaches every native bundle |

`vscode` and `desktop` run in parallel, and the three `desktop` runners do not
wait on each other (`fail-fast: false`). Any of them can fail without losing the
tag, the Release, or the other platforms' bundles.

## The artifacts

- **`prompt-burn-X.Y.Z.vsix`** — install with `code --install-extension
  prompt-burn-X.Y.Z.vsix`, or the Extensions view's *Install from VSIX…*. It is
  packaged with `--no-dependencies`: the host bundle produced by
  `vite.config.host.mts` already contains the `@prompt-burn/*` code, because
  those packages ship TypeScript sources that only resolve inside this checkout.
- **`Prompt Burn_X.Y.Z_aarch64.dmg`** — macOS, Apple silicon only (the runner is
  arm64). **Unsigned and unnotarised**: first launch needs right-click → Open, or
  `xattr -dr com.apple.quarantine "/Applications/Prompt Burn.app"`.
- **`Prompt Burn_X.Y.Z_x64_en-US.msi`** and **`Prompt Burn_X.Y.Z_x64-setup.exe`** —
  Windows installers (MSI and NSIS). Unsigned, so SmartScreen shows *More info →
  Run anyway* on first install.
- **`prompt-burn_X.Y.Z_amd64.deb`**, **`prompt-burn-X.Y.Z-1.x86_64.rpm`**,
  **`prompt-burn_X.Y.Z_amd64.AppImage`** — Linux x86_64. The AppImage needs
  `chmod +x` and nothing else; the `.deb` and `.rpm` install the same binary.

Bundle names come from Tauri's `"targets": "all"`, which emits each platform's
native formats. Only x86_64 Linux and Windows are built — no arm64 Linux, no
Intel macOS. Add a runner to the `desktop` matrix in `release.yml` if that
changes.

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

The `tag` job is the only one that writes to the repository, and it is the last
step in that job. Anything after it can be retried without cleanup.

- **`tag` failed on checks** — nothing was pushed. Fix `main`, run again.
- **`tag` pushed, `release` failed** — the tag exists. Create the Release by
  hand: `gh release create vX.Y.Z --generate-notes --verify-tag`, then upload
  the artifacts as below.
- **An artifact job failed** — the tag and Release survive. Fix the build, then
  either re-run that job from the Actions UI or attach it manually:

  ```sh
  gh release upload vX.Y.Z apps/vscode/prompt-burn-X.Y.Z.vsix --clobber
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
