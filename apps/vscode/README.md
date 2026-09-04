# prompt-burn-vscode

The VS Code shell. **Prompt Burn: Open Dashboard** opens a tab called
`Prompt Burn` in the editor area, at full editor width — a custom editor over a
virtual `prompt-burn:` URI, not a sidebar view, so the tab splits, moves and
restores like a file tab. `retainContextWhenHidden` keeps the webview alive
while another tab is in front.

The tab currently shows a placeholder line. The extension host does not read
usage yet and does not host `@prompt-burn/ui`; those are the next two commits,
and they reuse `packages/db` and `packages/collectors` rather than duplicating
the desktop app's I/O.

```sh
pnpm --filter prompt-burn-vscode build   # tsc -> out/, what `main` points at
pnpm --filter prompt-burn-vscode test    # manifest and host agree on ids
```

Opening the tab itself is checked by hand: build, run the extension in an
Extension Development Host, and run the command from the palette.
