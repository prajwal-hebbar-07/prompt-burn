/**
 * The extension host's data side: a `UsageReader` over the shared database.
 *
 * The host — not the webview — is where fs, sqlite and HTTP are allowed, so
 * this is where the reader gets built. It is the same `@prompt-burn/reader`
 * implementation the desktop sidecar runs, over the same
 * `~/.prompt-burn/db.sqlite`, so the VS Code tab sees the rows the desktop app
 * already synced and vice versa. Nothing here re-parses OMP or Claude Code
 * transcripts, re-reads Cursor's `state.vscdb` or opens a second sqlite stack.
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
  /** Claude Code projects directory. Injected by tests only. */
  claudeDirectory?: string;
  /** `agy` conversations directory. Injected by tests only. */
  agyDirectory?: string;
  /** Cursor `state.vscdb` path. Injected by tests only. */
  cursorStatePath?: string;
  /** HTTP for the Cursor pass. Injected by tests only. */
  fetchImpl?: typeof fetch;
  /** `agy`'s raw keychain secret for the Antigravity pass. Tests only. */
  antigravitySecret?: () => string;
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
