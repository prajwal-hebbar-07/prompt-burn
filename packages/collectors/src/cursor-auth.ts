/**
 * Cursor's access token, read from Cursor's own state — never stored by us.
 *
 * Cursor keeps its signed-in session JWT in `state.vscdb` (`ItemTable`, key
 * `cursorAuth/accessToken`). We look that one key up at fetch time and hand the
 * value back in memory: it must never reach `~/.prompt-burn/db.sqlite`, a log
 * line, or a fixture.
 *
 * The file is large (~90 MB) and Cursor may hold a WAL on it while running, so
 * the open is read-only + `immutable=1` and the lookup is keyed — no scan.
 *
 * Every failure is data, not an exception: Cursor may not be installed, the
 * user may be signed out, or the token may have expired.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** A usable, unexpired session token plus the WorkOS user id from its payload. */
export interface CursorToken {
  ok: true;
  /** The raw JWT. In memory only. */
  token: string;
  /** `sub` — the WorkOS user id, needed to build the session cookie. */
  userId: string;
  expiresAt: Date;
}

export interface CursorAuthUnavailable {
  ok: false;
  /**
   * `not_installed` — no `state.vscdb`; `signed_out` — no auth key in it;
   * `expired` — the JWT's `exp` has passed; `unreadable` — the file or the
   * token did not parse.
   */
  reason: "not_installed" | "signed_out" | "expired" | "unreadable";
  /** Human-readable detail. Never contains the token. */
  detail: string;
}

export type CursorAuth = CursorToken | CursorAuthUnavailable;

const AUTH_KEY = "cursorAuth/accessToken";

/** Where Cursor keeps its global storage on macOS. */
export function defaultCursorStatePath(home: string = homedir()): string {
  return join(
    home,
    "Library",
    "Application Support",
    "Cursor",
    "User",
    "globalStorage",
    "state.vscdb",
  );
}

/** Reads the current Cursor session token, or says why there isn't one. */
export function readCursorAuth(statePath: string = defaultCursorStatePath()): CursorAuth {
  if (!existsSync(statePath)) {
    return { ok: false, reason: "not_installed", detail: `No Cursor state at ${statePath}` };
  }

  let value: unknown;
  try {
    const db = new DatabaseSync(`file:${statePath}?mode=ro&immutable=1`, { readOnly: true });
    try {
      value = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(AUTH_KEY)?.value;
    } finally {
      db.close();
    }
  } catch (error) {
    return {
      ok: false,
      reason: "unreadable",
      detail: `Cannot read ${statePath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (value === undefined || value === null) {
    return { ok: false, reason: "signed_out", detail: `No ${AUTH_KEY} in ${statePath}` };
  }
  const token = typeof value === "string" ? value : Buffer.from(value as Uint8Array).toString();
  const claims = decodeClaims(token);
  if (!claims) {
    return { ok: false, reason: "unreadable", detail: `${AUTH_KEY} is not a readable JWT` };
  }

  const expiresAt = new Date(claims.exp * 1000);
  if (expiresAt.getTime() <= Date.now()) {
    return {
      ok: false,
      reason: "expired",
      detail: `Cursor token expired ${expiresAt.toISOString()} — sign in to Cursor again`,
    };
  }
  return { ok: true, token, userId: claims.sub, expiresAt };
}

/** The two payload claims we need. `null` for anything we cannot trust. */
function decodeClaims(token: string): { sub: string; exp: number } | null {
  const payload = token.split(".")[1];
  if (!payload) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const { sub, exp } = parsed as { sub?: unknown; exp?: unknown };
  if (typeof sub !== "string" || !sub) return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  return { sub, exp };
}
