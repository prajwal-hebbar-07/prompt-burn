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

On open the webview asks the sidecar to sync OMP and then for an all-time
snapshot, and renders the estimated total through `@prompt-burn/ui`. **Fetch
data** asks again; nothing else does. While a fetch runs the previous number
stays on screen with a spinner, and a failed fetch leaves it alone.

Rust relays one protocol line at a time between the webview and the sidecar
(`sidecar_request`); the request and response shapes live in TypeScript on both
ends. `pnpm --filter @prompt-burn/desktop test` covers the sidecar protocol and
the window's fetch wiring without a Rust toolchain.
