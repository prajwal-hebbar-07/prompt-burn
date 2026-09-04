# @prompt-burn/desktop

The Tauri v2 window plus the Node sidecar that owns the database. Rust does the
window; everything data lives in TypeScript so the VS Code host can share it.

```sh
pnpm --filter @prompt-burn/desktop tauri dev   # needs a Rust toolchain
```

The sidecar announces itself on stdout as the window comes up:

```
[sidecar] {"type":"ready","database":"/Users/you/.prompt-burn/db.sqlite","tables":5}
```

That is the whole shell: one window, one sidecar, one open database (created
with `schema.sql` on first run). Fetching, aggregation and the estimated total
land in the commits after it. `pnpm --filter @prompt-burn/desktop test` proves
the database open without a Rust toolchain.
