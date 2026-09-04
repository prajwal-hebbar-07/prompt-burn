# prompt-burn-vscode

The VS Code shell. **Prompt Burn: Open Dashboard** opens a tab called
`Prompt Burn` in the editor area, at full editor width — a custom editor over a
virtual `prompt-burn:` URI, not a sidebar view, so the tab splits, moves and
restores like a file tab. `retainContextWhenHidden` keeps the webview alive
while another tab is in front.

`src/reader.ts` is the host's data side: `createHostReader` opens the shared
`~/.prompt-burn/db.sqlite` and returns the `@prompt-burn/reader`
implementation the desktop sidecar runs, so `discover` / `fetch` /
`getSnapshot` behave identically in both shells and neither re-parses OMP
transcripts nor re-reads Cursor's `state.vscdb`.

The tab renders `@prompt-burn/ui` — the same `AppShell`, Dashboard and
Settings the desktop window mounts, no second dashboard. `web/` is the bundle
(Vite, React, Tailwind); it never imports the reader, the db or the collectors.
It asks this host over `postMessage` and gets a `DashboardSnapshot` back:
`fetch` runs the collector pass then re-reads the snapshot, `getSnapshot`
re-aggregates what is already stored. Fetch happens once when the tab opens and
again only on **Fetch data**; a period change is a `getSnapshot`, never a fetch,
and a failed fetch keeps the previous numbers on screen.

Settings are display only — writes are commit 28.

```sh
pnpm --filter prompt-burn-vscode build   # tsc -> out/ (host) + vite -> dist/ (webview)
pnpm --filter prompt-burn-vscode test    # host protocol, tab wiring, manifest ids
```

Opening the tab itself is checked by hand: build, run the extension in an
Extension Development Host, and run the command from the palette.
