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
| `src-tauri/src/main.rs`               | Rust   | Spawns the sidecar, holds the `Child`, runs the Tauri builder |
| `src-tauri/tauri.conf.json`           | Config | One 900×620 window, `frontendDist: ../web`, no bundle         |
| `src-tauri/Cargo.toml` / `build.rs`   | Rust   | `tauri` 2 + `tauri-build`; no extra features                  |
| `src-tauri/capabilities/default.json` | Config | `core:default` perms for the `main` window only               |
| `sidecar/index.ts`                    | TS     | The sidecar: open DB, print ready line, idle on stdin         |
| `sidecar/ts-resolve.mjs`              | MJS    | Module hook so bare `node` runs the TypeScript source         |
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
    D --> E[openDatabase: mkdir, create if new, apply schema.sql]
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
  host: `~/.prompt-burn/db.sqlite`, created with `schema.sql` on first run (§`@prompt-burn/db`).
- **The ready line is the health check.** It is printed only after a `sqlite_schema` count runs
  _through the connection_, so `tables` proves a live database, not merely an existing file. A
  first run reports the freshly-applied schema; later runs report what was already there.
- **One client, one direction.** The window is the sidecar's only client, and (for now) the only
  data crossing the pipe is stdout → the Rust log. `stdin` is never written; closing it is the
  only signal sent.
- **Dev-path assumption.** `sidecar_command()` builds its paths from `CARGO_MANIFEST_DIR`, i.e.
  the sidecar always runs from source next to the crate. Fine in dev, wrong for packaging (§9).
- **`node` on PATH.** `Command::new("node")` resolves from `PATH`; a missing `node` fails the
  `expect("could not start the Node sidecar (is `node` on PATH?)")` and the window never opens.

## 6. Configuration

Almost none, on purpose:

- `tauri.conf.json`: `identifier dev.promptburn.desktop`, one window (`main`, "Prompt Burn",
  900×620), CSP `default-src 'self'`, frontend served from `../web`. `bundle.active: false` —
  no icons exist yet, so there is nothing to bundle.
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

- **The sidecar runs from TypeScript source, no bundling.** Both the `node --import` invocation
  in `main.rs` and `ts-resolve.mjs` are explicitly dev-time hacks (both carry `ponytail:`
  comments saying so). Packaging the app must bundle the sidecar — or ship a Node SEA — and
  then the resolver hook dies. Until then `tauri build` produces nothing useful anyway,
  because `bundle.active` is `false`.
- **`node` must be on PATH, and failure is a panic.** A missing `node` panics the Rust `main`
  via the explanatory `expect`. Acceptable for dev; a packaged app must not depend on PATH.
- **The ready line prints the full home-relative database path** — user-visible on the console
  behind the window, in the logs, and in the test. Fine now; revisit if the line ever carries
  more.
- **The webview is a dead end.** Static `index.html`, no request protocol, no `UsageReader`,
  no data flowing to the window. Commits 13–15 add the protocol, fetching/aggregation, and the
  estimated total; nothing here anticipates their shape except the reader-thread placeholder.
- **No icons, no bundle.** `bundle.active: false` until icons exist.
- **The test's `HOME` override is mac/unix-only.** `@prompt-burn/db` honours `HOME`, which
  Windows does not set the same way; the test passes on macOS and unix, not on Windows.

## 10. Change guide

- **Adding anything user-visible:** it does not go in this pair until there is a data path. The
  window stays `web/index.html`; the request protocol and `UsageReader` land in commits 13–15
  and will rewrite §3–§4 of this document.
- **Touching the sidecar:** `sidecar/index.ts` is deliberately minimal — database open, ready
  line, stdin idle. Keep the ready line the first stdout output (the test parses the _first_
  line) and keep shutdown as close-and-exit-0; the pipe-closes contract depends on it.
- **Packaging (when it happens):** bundle the sidecar, delete `ts-resolve.mjs` and the
  `--import` argument, flip `bundle.active` on with icons, and remove the PATH dependency from
  `sidecar_command()`. Each of those is tracked by the `ponytail:` comments in the two files.
- **Touching the database open:** `openDatabase` in `@prompt-burn/db` owns creation and schema
  application; the sidecar only calls it. Do not re-create that logic here.
