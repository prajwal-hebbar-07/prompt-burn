/**
 * The extension host's data side: a `UsageReader` over the shared database.
 *
 * The host — not the webview — is where fs, sqlite and HTTP are allowed, so
 * this is where the reader gets built. It is the same `@prompt-burn/reader`
 * implementation the desktop sidecar runs, over the same
 * `~/.prompt-burn/db.sqlite`, so the VS Code tab sees the OMP rows the desktop
 * app already synced and vice versa. Nothing here re-parses OMP transcripts,
 * re-reads Cursor's `state.vscdb` or opens a second sqlite stack.
 *
 * Commit 27 wires this to the webview over `postMessage`; the tab is still a
 * placeholder, so `extension.ts` does not call it yet.
 */

import { databasePath, openDatabase } from "@prompt-burn/db";
import { createUsageReader, type UsageReader } from "@prompt-burn/reader";

export interface HostReaderOptions {
  /** Home directory holding `.prompt-burn/db.sqlite`. Injected by tests only. */
  home?: string;
  /** OMP sessions directory. Injected by tests only. */
  ompDirectory?: string;
  /** Cursor `state.vscdb` path. Injected by tests only. */
  cursorStatePath?: string;
  /** HTTP for the Cursor pass. Injected by tests only. */
  fetchImpl?: typeof fetch;
}

/**
 * Opens the shared database and returns the reader over it. `openDatabase`
 * creates the file, the schema and the bundled prices only when it is new, so
 * whichever shell runs first wins and the other opens what is already there.
 */
export function createHostReader(options: HostReaderOptions = {}): UsageReader {
  const { home, ...forwarded } = options;
  return createUsageReader(openDatabase(databasePath(home)), forwarded);
}
