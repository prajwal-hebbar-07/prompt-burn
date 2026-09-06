/**
 * The Prompt Burn database: one SQLite file at `~/.prompt-burn/db.sqlite`.
 *
 * Home-relative on purpose — it must sit outside every install directory so an
 * app update, a reinstall, or a VS Code extension upgrade cannot delete it. The
 * desktop app and the VS Code extension open this same file; there is no second
 * location and no per-app database.
 *
 * Uses `node:sqlite` (Node 24+, already required by `.nvmrc`) rather than the
 * `better-sqlite3` the plan sketches, keeping the workspace dependency-free as
 * the spike did. Reading Cursor's `state.vscdb` is a separate decision.
 */

import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BUNDLED_PRICES, SEED_EFFECTIVE_FROM } from "./prices.js";
import { SCHEMA_SQL } from "./schema.js";

export { BUNDLED_PRICES, SEED_EFFECTIVE_FROM, type BundledPrice } from "./prices.js";
export { SCHEMA_SQL } from "./schema.js";
export {
  estimateCents,
  insertPriceEntry,
  resolvePrice,
  type NewPriceEntry,
  type PriceRate,
  type TokenCounts,
} from "./pricing.js";
export {
  DEFAULT_SETTINGS,
  readSettings,
  writeSettings,
  type AppSettings,
} from "./settings.js";
export { loadUsageEvents } from "./events.js";

/** Application data directory, e.g. `/Users/you/.prompt-burn`. */
export function appDirectory(home: string = homedir()): string {
  return join(home, ".prompt-burn");
}

/** The one database path. `home` is injectable so tests never touch a real one. */
export function databasePath(home: string = homedir()): string {
  return join(appDirectory(home), "db.sqlite");
}

/**
 * Opens the database, creating the directory, the file and the schema on first
 * run, topping up the bundled prices, and adding `usage_events.project` to a
 * database created before it existed.
 *
 * That column is the one migration there is (there is still no runner). Stored
 * rows keep their tokens and gain a NULL project; clearing `omp_sync_state`
 * makes the next fetch re-read every transcript, and the sync's upsert fills
 * the column in from each session header's `cwd`. Nothing is deleted, so a
 * project whose transcripts have since been pruned keeps its history — it just
 * stays unattributed.
 */
export function openDatabase(path: string = databasePath()): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const isNew = !existsSync(path);
  const db = new DatabaseSync(path);
  if (isNew) db.exec(SCHEMA_SQL);
  else addProjectColumn(db);
  seedBundledPrices(db);
  return db;
}

/** No-op once the column is there; the whole migration is idempotent. */
function addProjectColumn(db: DatabaseSync): void {
  const columns = db.prepare("SELECT name FROM pragma_table_info('usage_events')").all() as Array<{
    name: string;
  }>;
  if (columns.some((column) => column.name === "project")) return;
  db.exec(`
    ALTER TABLE usage_events ADD COLUMN project TEXT;
    CREATE INDEX IF NOT EXISTS usage_events_project ON usage_events (project);
    DELETE FROM omp_sync_state;`);
}

/**
 * Inserts the bundled rates that this database does not have yet.
 *
 * Runs on every open, not only on create: a release that adds a model — a new
 * Cursor id, a new vendor — has to reach databases that already exist, and
 * there is no migration runner to carry it. Rows are matched on
 * `(model, provider, effective_from)`, which is exactly one backdated seed row's
 * identity, so nothing is duplicated, and a rate added in Settings or a later
 * row closing a seed is never touched.
 *
 * The price of that: deleting a bundled row does not stick — it returns on the
 * next open. Close it with `effective_until` instead.
 */
export function seedBundledPrices(db: DatabaseSync): void {
  const insert = db.prepare(
    `INSERT INTO price_entries
       (model, provider, effective_from, effective_until,
        input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok)
     SELECT ?, ?, ?, NULL, ?, ?, ?, ?
      WHERE NOT EXISTS (
            SELECT 1 FROM price_entries
             WHERE model = ? AND provider = ? AND effective_from = ?)`,
  );
  for (const rate of BUNDLED_PRICES) {
    insert.run(
      rate.model,
      rate.provider,
      SEED_EFFECTIVE_FROM,
      rate.inputPerMtok,
      rate.outputPerMtok,
      rate.cacheReadPerMtok,
      rate.cacheWritePerMtok,
      rate.model,
      rate.provider,
      SEED_EFFECTIVE_FROM,
    );
  }
}
