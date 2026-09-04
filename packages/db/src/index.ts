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

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BUNDLED_PRICES, SEED_EFFECTIVE_FROM } from "./prices.js";

export { BUNDLED_PRICES, SEED_EFFECTIVE_FROM, type BundledPrice } from "./prices.js";
export {
  estimateCents,
  resolvePrice,
  type PriceRate,
  type TokenCounts,
} from "./pricing.js";

/** Application data directory, e.g. `/Users/you/.prompt-burn`. */
export function appDirectory(home: string = homedir()): string {
  return join(home, ".prompt-burn");
}

/** The one database path. `home` is injectable so tests never touch a real one. */
export function databasePath(home: string = homedir()): string {
  return join(appDirectory(home), "db.sqlite");
}

const SCHEMA_SQL = new URL("./schema.sql", import.meta.url);

/**
 * Opens the database, creating the directory, the file, the schema and the
 * bundled prices on first run.
 *
 * An existing file is opened as-is: no schema re-apply, no re-seed, no
 * migration runner. Deleting the file is the reset path, and it is also how a
 * schema change is picked up until migrations exist.
 */
export function openDatabase(path: string = databasePath()): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const isNew = !existsSync(path);
  const db = new DatabaseSync(path);
  if (isNew) {
    db.exec(readFileSync(SCHEMA_SQL, "utf8"));
    seedBundledPrices(db);
  }
  return db;
}

/**
 * Inserts the bundled rates. Called once, on create — running it against a
 * populated database would duplicate every row, since a model legitimately has
 * many price rows across time.
 */
export function seedBundledPrices(db: DatabaseSync): void {
  const insert = db.prepare(
    `INSERT INTO price_entries
       (model, provider, effective_from, effective_until,
        input_per_mtok, output_per_mtok, cache_read_per_mtok, cache_write_per_mtok)
     VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
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
    );
  }
}
