<!-- paper-target:start -->
## Paper design target

Design work in this repo reads from one Paper file and page. Before any Paper
MCP read, call `open_file` with these, then confirm with `get_basic_info`.

- File: `prompt-burn` — fileId `01M16P0E4DX1BSSM4FYRWJWXKZ`
- Page: `v0-wireframes` — pageId `1-0`
- Confirmed: `2026-09-02` via `get_basic_info`

Pass `fileId` on every Paper tool call. If `get_basic_info` reports a different
file or page, re-open the target — do not read the focused one. An explicit
`file=` / `page=` in the user's message overrides this block; a stale block is
fixed by re-running `paper-target`, never by silently using another file.
<!-- paper-target:end -->
