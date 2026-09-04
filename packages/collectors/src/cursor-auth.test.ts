/**
 * Token read against a synthetic `state.vscdb` in a temp dir. The real Cursor
 * install is never opened and the JWTs here are unsigned fakes, so no live
 * token exists in this file or its output.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { databasePath, openDatabase } from "@prompt-burn/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultCursorStatePath, readCursorAuth } from "./index.js";

const HOUR = 3600;

/** A structurally valid, unsigned JWT with the claims we read. */
function fakeJwt(expSecondsFromNow: number, sub = "user_01SYNTHETIC"): string {
  const claims = { sub, exp: Math.floor(Date.now() / 1000) + expSecondsFromNow, type: "session" };
  return [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    "not-a-signature",
  ].join(".");
}

let root: string;
let statePath: string;

/** Writes a `state.vscdb` holding exactly the rows given. */
function writeState(rows: Record<string, string>): void {
  const db = new DatabaseSync(statePath);
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
  const insert = db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)");
  for (const [key, value] of Object.entries(rows)) insert.run(key, value);
  db.close();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "prompt-burn-cursor-auth-"));
  statePath = join(root, "state.vscdb");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readCursorAuth", () => {
  it("reports not_installed when there is no state.vscdb", () => {
    const auth = readCursorAuth(join(root, "missing", "state.vscdb"));
    expect(auth).toMatchObject({ ok: false, reason: "not_installed" });
  });

  it("reports signed_out when the auth key is absent", () => {
    writeState({ "someOtherSetting/value": "{}" });
    expect(readCursorAuth(statePath)).toMatchObject({ ok: false, reason: "signed_out" });
  });

  it("reports expired for a token whose exp has passed", () => {
    writeState({ "cursorAuth/accessToken": fakeJwt(-HOUR) });
    const auth = readCursorAuth(statePath);
    expect(auth).toMatchObject({ ok: false, reason: "expired" });
    expect(auth.ok).toBe(false);
    if (!auth.ok) expect(auth.detail).not.toContain("eyJ");
  });

  it("reports unreadable for a value that is not a JWT", () => {
    writeState({ "cursorAuth/accessToken": "definitely-not-a-jwt" });
    expect(readCursorAuth(statePath)).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("reports unreadable when the file is not a database", () => {
    writeFileSync(statePath, "garbage");
    expect(readCursorAuth(statePath)).toMatchObject({ ok: false, reason: "unreadable" });
  });

  it("returns the token and WorkOS user id when signed in", () => {
    const jwt = fakeJwt(24 * HOUR);
    writeState({ "cursorAuth/accessToken": jwt, "someOtherSetting/value": "{}" });

    const auth = readCursorAuth(statePath);
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    expect(auth.token).toBe(jwt);
    expect(auth.userId).toBe("user_01SYNTHETIC");
    expect(auth.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("never lands the token in Prompt Burn's database", () => {
    const jwt = fakeJwt(24 * HOUR);
    writeState({ "cursorAuth/accessToken": jwt });
    const ourDbPath = databasePath(root);
    const db = openDatabase(ourDbPath);

    const auth = readCursorAuth(statePath);
    expect(auth.ok).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM settings").get()).toMatchObject({ n: 0 });
    db.close();
    expect(readFileSync(ourDbPath, "latin1")).not.toContain(jwt);
  });

  it("defaults to Cursor's macOS global storage", () => {
    expect(defaultCursorStatePath("/tmp/home")).toBe(
      "/tmp/home/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    );
  });
});
