/**
 * The desktop sidecar: the Node process that owns SQLite for the Tauri window.
 *
 * Rust spawns this on startup and holds its stdin; SQLite, the collectors and
 * the Cursor HTTP client stay in TypeScript so the VS Code host can reuse them
 * verbatim.
 *
 * Protocol: newline-delimited JSON on stdin, one response per line on stdout.
 * The ready line stays the first output (the test parses it). Requests carry an
 * `id` so the window can match responses once requests overlap.
 */

import { databasePath, openDatabase } from "@prompt-burn/db";
import { createUsageReader, type UsageReader } from "./reader.js";

const path = databasePath();
const db = openDatabase(path);
const reader: UsageReader = createUsageReader(db);

// Proof the connection is live, not just a file handle: the schema is queried
// through it. On a first run `openDatabase` created the file and applied
// schema.sql; on later runs it opened what was already there.
const { tables } = db
  .prepare("SELECT count(*) AS tables FROM sqlite_schema WHERE type = 'table'")
  .get() as { tables: number };

process.stdout.write(`${JSON.stringify({ type: "ready", database: path, tables })}\n`);

interface Request {
  id?: unknown;
  method?: unknown;
}

const METHODS = {
  discover: () => reader.discover(),
  fetch: () => reader.fetch(),
  getSnapshot: (request: { period?: unknown }) =>
    reader.getSnapshot(
      typeof request.period === "object" && request.period !== null
        ? (request.period as Parameters<UsageReader["getSnapshot"]>[0])
        : { kind: "all_time" },
    ),
} as const;

/** One request line in, one response line out. Failures are data, not exits. */
async function respond(line: string): Promise<void> {
  let request: Request;
  let id: unknown = null;
  try {
    request = JSON.parse(line) as Request;
    id = request.id ?? null;
    const method = request.method;
    if (typeof method !== "string" || !(method in METHODS)) {
      throw new Error(`Unknown method ${JSON.stringify(method)}`);
    }
    const result = await METHODS[method as keyof typeof METHODS](request as never);
    process.stdout.write(`${JSON.stringify({ type: "response", id, ok: true, result })}\n`);
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        type: "response",
        id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
    );
  }
}

function shutdown(): void {
  db.close();
  process.exit(0);
}

// The window is the only client. Its stdin pipe closing — window quit, crash,
// kill — is the shutdown signal, so no orphan holds the database open.
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk: string) => {
  // The last line before close may lack its newline; it is still a request.
  for (const line of chunk.split("\n")) {
    if (line.trim() !== "") void respond(line);
  }
});
process.stdin.on("end", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);