/**
 * The desktop sidecar: the Node process that owns SQLite for the Tauri window.
 *
 * Rust spawns this on startup and holds its stdin; SQLite, the collectors and
 * the Cursor HTTP client stay in TypeScript so the VS Code host can reuse them
 * verbatim. Nothing but the database open lives here yet — `UsageReader`
 * (discover / fetch / getSnapshot) and the request protocol land next.
 */

import { databasePath, openDatabase } from "@prompt-burn/db";

const path = databasePath();
const db = openDatabase(path);

// Proof the connection is live, not just a file handle: the schema is queried
// through it. On a first run `openDatabase` created the file and applied
// schema.sql; on later runs it opened what was already there.
const { tables } = db
  .prepare("SELECT count(*) AS tables FROM sqlite_schema WHERE type = 'table'")
  .get() as { tables: number };

process.stdout.write(`${JSON.stringify({ type: "ready", database: path, tables })}\n`);

function shutdown(): void {
  db.close();
  process.exit(0);
}

// The window is the only client. Its stdin pipe closing — window quit, crash,
// kill — is the shutdown signal, so no orphan holds the database open.
process.stdin.resume();
process.stdin.on("end", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
