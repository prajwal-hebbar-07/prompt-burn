# Desktop shell (Tauri v2 + Node sidecar)

> **Plain English:** [The front door](../plain-english/07-the-front-door.md)

## 1. Purpose

Commit 12 of the plan: the shell only. `apps/desktop` stands up the desktop window — Tauri v2
owning a native window — plus a small Node sidecar that owns the database. Rust deliberately
does _only_ the window: SQLite, the collectors and the Cursor HTTP client stay in TypeScript so
the planned `apps/vscode` host can reuse them verbatim. Nothing user-facing works yet —
the window shows a static placeholder, the sidecar only opens the database, and the request
protocol between them lands in commits 13–15.

## 2. Inventory

| File                                  | Kind   | Role                                                          |
| ------------------------------------- | ------ | ------------------------------------------------------------- |
| `src-tauri/src/main.rs`               | Rust   | Finds Node, spawns the sidecar, holds the `Child`, runs the builder |
| `src-tauri/tauri.conf.json`           | Config | One 900×620 window, `frontendDist: ../dist`, bundles `sidecar.mjs` as a resource |
| `src-tauri/Cargo.toml` / `build.rs`   | Rust   | `tauri` 2 + `tauri-build`; no extra features                  |
| `src-tauri/capabilities/default.json` | Config | `core:default` perms for the `main` window only               |
| `sidecar/index.ts`                    | TS     | The sidecar: open DB, print ready line, idle on stdin         |
| `sidecar/ts-resolve.mjs`              | MJS    | Module hook so bare `node` runs the TypeScript source         |
| `vite.config.sidecar.mts`             | Config | Bundles the sidecar to one ESM file for packaged builds       |
| `sidecar/index.test.ts`               | Test   | Temp-`HOME` spawn; asserts ready line, DB, exit 0             |
| `web/index.html`                      | HTML   | Static placeholder; no data path to the sidecar yet           |
| `package.json` / `tsconfig.json`      | Config | `@prompt-burn/db` dep; typecheck/test/tauri scripts           |

## 3. Public surface

Three surfaces, one per process:

- **The window** (`pnpm --filter @prompt-burn/desktop tauri dev`) shows `web/index.html` with the
  text "Shell only. The Node sidecar holds the database; the estimated total lands later."
- **The sidecar's stdout**, exactly one line before it idles:

  ```
  {"type":"ready","database":"/Users/you/.prompt-burn/db.sqlite","tables":5}
  ```

- **The test** (`pnpm --filter @prompt-burn/desktop test`) proves the database open without a
  Rust toolchain.

There is no frontend IPC — `capabilities/default.json` grants `core:default` only — and no
request protocol: the Rust side currently _reads_ the sidecar's stdout only to log it.

## 4. Flow

```mermaid
flowchart TD
    A[tauri dev / cargo run] --> B[main.rs: spawn_sidecar]
    B --> C["node --import ts-resolve.mjs sidecar/index.ts"]
    C --> D[databasePath\(\) from @prompt-burn/db]
    D --> E[openDatabase: mkdir, create if new, apply SCHEMA_SQL]
    E --> F[sqlite_schema table count through the connection]
    F --> G[one JSON ready line on stdout]
    G --> H[Rust reader thread logs "[sidecar] …"]
    H --> I[tauri::Builder::run — window shows web/index.html]
    I -- app exit drops Sidecar, stdin closes --> J[sidecar stdin "end" event]
    J --> K[db.close\(\), process.exit\(0\)]
    I -- SIGINT/SIGTERM --> K
```

The lifetime trick is the whole point of `struct Sidecar(Child)` in Tauri's managed state:
holding the child holds its stdin pipe open. When the Tauri app exits, the state drops and the
pipe closes; the sidecar's stdin `end` event fires and it closes the database itself. There is
no kill logic — the pipe _is_ the shutdown signal.

## 5. Contracts and invariants

- **One database, three hosts.** The sidecar opens the same `databasePath()` as every other
  host: `~/.prompt-burn/db.sqlite`, created from the inlined `SCHEMA_SQL` on first run
  (§`@prompt-burn/db`).
- **The ready line is the health check.** It is printed only after a `sqlite_schema` count runs
  _through the connection_, so `tables` proves a live database, not merely an existing file. A
  first run reports the freshly-applied schema; later runs report what was already there.
- **One client, one direction.** The window is the sidecar's only client, and (for now) the only
  data crossing the pipe is stdout → the Rust log. `stdin` is never written; closing it is the
  only signal sent.
- **Two sidecar layouts, one protocol.** A debug build runs `sidecar/index.ts` from the
  workspace through `ts-resolve.mjs`; a packaged build runs `sidecar.mjs` — the Vite-bundled
  sidecar with the workspace packages inlined — resolved through
  `BaseDirectory::Resource`. `CARGO_MANIFEST_DIR` is a build-machine path and is used only
  under `debug_assertions`.
- **Node is found, not assumed.** A GUI launch inherits launchd's `PATH`, which has no nvm,
  fnm, asdf, Volta or Homebrew Node in it. `node_binary()` tries `PATH`, then asks the login
  shell (`$SHELL -lc 'command -v node'`), then a short list of standard locations.
- **A missing sidecar never takes the window with it.** The spawn happens in `setup` and its
  result is `manage`d as `Result<Sidecar, String>`; every `sidecar_request` answers with the
  stored error, so the window opens and the UI's error banner explains the problem.

## 6. Configuration

Almost none, on purpose:

- `tauri.conf.json`: `identifier dev.promptburn.desktop`, one window (`main`, "Prompt Burn",
  900×620), CSP `default-src 'self'`, frontend served from `../dist`. `bundle.active: true`
  with `targets: "all"`, the icon set, and `sidecar-dist/sidecar.mjs` carried as the
  `sidecar.mjs` resource.
- `capabilities/default.json`: `core:default` only, scoped to `windows: ["main"]`.
- `tsconfig.json` extends `tsconfig.base.json`, adds `"types": ["node"]`, includes
  `sidecar/**/*.ts`.
- No env vars are read by the shell itself; the sidecar inherits `HOME` (via
  `@prompt-burn/db`) to locate the database.

## 7. Boundaries and dependencies

- **Rust:** `tauri` 2 and `tauri-build` only. No plugins, no features, no IPC commands.
- **Node:** the sidecar's only runtime dependency is `@prompt-burn/db` (workspace). Dev deps:
  `@tauri-apps/cli`, `@types/node`, `vitest`.
- **Node version:** the type-stripping module hook targets Node 24 (the repo's `.nvmrc` line).
- **Reads/writes:** the sidecar touches only `~/.prompt-burn/db.sqlite` (creating it if
  missing). It opens no network sockets, reads no Cursor storage — that arrives with the
  collectors being wired in.
- The webview is a plain static file; there is no frontend build step (`frontendDist` is the raw
  `web/` directory).

## 8. Tests

One test, `sidecar/index.test.ts`, and it exercises the real sidecar process, not a mock:

1. Creates a throwaway home with `mkdtempSync` under the OS temp dir and spawns
   `process.execPath --import ts-resolve.mjs index.ts` with `HOME` pointed at it — the real
   `~/.prompt-burn/db.sqlite` is never touched.
2. Reads the first stdout line, parses it, and asserts `type: "ready"`, that `database` equals
   `<home>/.prompt-burn/db.sqlite`, that the file exists, and that `tables > 0`.
3. Ends the child's stdin and asserts the process exits with code 0 — the shutdown contract.
   A `finally` block kills the child and removes the temp home either way.

Not covered: the Rust side. Spawning, the log thread, and the pipe-closes-on-exit behaviour are
only observable by running `tauri dev` with a Rust toolchain; the test deliberately proves the
database open without one.

## 9. Debt and traps

- **A packaged app still needs Node installed.** The sidecar is bundled to one `.mjs`, but it
  is run by the user's own Node (24+, for `node:sqlite`). A machine without Node opens the
  window and shows the "Node 24 or newer is required" error instead of data. Shipping a Node
  SEA — or compiling the sidecar to a standalone binary and declaring it as `externalBin` —
  is what removes that requirement.
- **Node discovery reaches outside the process.** `node_binary()` runs `$SHELL -lc 'command -v
  node'` when `PATH` fails, which sources the user's profile. That is what finds nvm; it also
  means a profile that prints to stdout can confuse the probe, and the `-l` form does nothing
  on Windows (where Node is normally on `PATH` anyway).
- **The ready line prints the full home-relative database path** — user-visible on the console
  behind the window, in the logs, and in the test. Fine now; revisit if the line ever carries
  more.
- **The webview is a dead end.** Static `index.html`, no request protocol, no `UsageReader`,
  no data flowing to the window. Commits 13–15 add the protocol, fetching/aggregation, and the
  estimated total; nothing here anticipates their shape except the reader-thread placeholder.
- **`ts-resolve.mjs` is still dev-only.** It exists so debug builds skip the bundle step; the
  packaged path never loads it.
- **The test's `HOME` override is mac/unix-only.** `@prompt-burn/db` honours `HOME`, which
  Windows does not set the same way; the test passes on macOS and unix, not on Windows.

## 10. Change guide

- **Adding anything user-visible:** it does not go in this pair until there is a data path. The
  window stays `web/index.html`; the request protocol and `UsageReader` land in commits 13–15
  and will rewrite §3–§4 of this document.
- **Touching the sidecar:** `sidecar/index.ts` is deliberately minimal — database open, ready
  line, stdin idle. Keep the ready line the first stdout output (the test parses the _first_
  line) and keep shutdown as close-and-exit-0; the pipe-closes contract depends on it.
- **Packaging:** `pnpm --filter @prompt-burn/desktop build` produces both `dist/` (webview) and
  `src-tauri/sidecar-dist/sidecar.mjs` (sidecar); `tauri.conf.json` carries the second as a
  resource. Changing either output path means changing `resources` and
  `sidecar_arguments()` together.
- **Touching the database open:** `openDatabase` in `@prompt-burn/db` owns creation and schema
  application; the sidecar only calls it. Do not re-create that logic here.
