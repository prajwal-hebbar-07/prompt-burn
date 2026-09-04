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

The tab itself still shows a placeholder line: nothing in `extension.ts` calls
the reader, webview scripts stay off, and `@prompt-burn/ui` is not hosted yet.
That is the next commit — `postMessage` between the tab and this reader.

```sh
pnpm --filter prompt-burn-vscode build   # tsc -> out/, what `main` points at
pnpm --filter prompt-burn-vscode test    # ids match the manifest; reader reads
```

Opening the tab itself is checked by hand: build, run the extension in an
Extension Development Host, and run the command from the palette.
