/**
 * The `settings` key/value table: source toggles and the transcript-path
 * overrides.
 *
 * One row per key in the same `~/.prompt-burn/db.sqlite` both shells open, so a
 * path typed in the desktop window is what the VS Code tab reads next time it
 * opens — and what the collectors use on the next fetch.
 *
 * Cursor auth never lands here. The access token is read from Cursor's own
 * `state.vscdb` at fetch time, and the optional `crsr_` Enterprise key has no
 * ingest yet, so neither is persisted.
 */

import type { DatabaseSync } from "node:sqlite";

/** What the shells may change. An empty path means "the collector default". */
export interface AppSettings {
  ompEnabled: boolean;
  ompPath: string;
  cursorEnabled: boolean;
  /**
   * Claude Code — the CLI behind the VS Code extension. Off hides it from the
   * dashboard as well as skipping the sync: the toggle is "do I want to see
   * this", not just "do I want to read it".
   */
  claudeEnabled: boolean;
  claudePath: string;
}

/** Every source on, no path override — what the Settings screen shows today. */
export const DEFAULT_SETTINGS: AppSettings = {
  ompEnabled: true,
  ompPath: "",
  cursorEnabled: true,
  claudeEnabled: true,
  claudePath: "",
};

const KEYS = {
  ompEnabled: "omp_enabled",
  ompPath: "omp_path",
  cursorEnabled: "cursor_enabled",
  claudeEnabled: "claude_enabled",
  claudePath: "claude_path",
} as const satisfies Record<keyof AppSettings, string>;

/** Stored settings, with a default for every key nobody has written yet. */
export function readSettings(db: DatabaseSync): AppSettings {
  const rows = db.prepare("SELECT key, value FROM settings").all() as Array<
    Record<string, unknown>
  >;
  const stored = new Map(
    rows.map((row) => [String(row["key"]), row["value"] === null ? "" : String(row["value"])]),
  );
  return {
    ompEnabled: readBoolean(stored.get(KEYS.ompEnabled), DEFAULT_SETTINGS.ompEnabled),
    ompPath: stored.get(KEYS.ompPath) ?? DEFAULT_SETTINGS.ompPath,
    cursorEnabled: readBoolean(stored.get(KEYS.cursorEnabled), DEFAULT_SETTINGS.cursorEnabled),
    claudeEnabled: readBoolean(stored.get(KEYS.claudeEnabled), DEFAULT_SETTINGS.claudeEnabled),
    claudePath: stored.get(KEYS.claudePath) ?? DEFAULT_SETTINGS.claudePath,
  };
}

/** Upserts only the keys `patch` mentions; the rest keep their stored value. */
export function writeSettings(db: DatabaseSync, patch: Partial<AppSettings>): void {
  const upsert = db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  );
  for (const [field, key] of Object.entries(KEYS) as Array<[keyof AppSettings, string]>) {
    const value = patch[field];
    if (value === undefined) continue;
    upsert.run(key, typeof value === "boolean" ? (value ? "1" : "0") : value);
  }
}

/** Booleans are stored as `1` / `0`; anything unwritten falls back. */
function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return value === "1" || value === "true";
}
