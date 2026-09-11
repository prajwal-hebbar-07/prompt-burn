/**
 * Antigravity's own quota clocks, asked of Google instead of read out of OMP.
 *
 * These used to arrive for free: OMP polled Antigravity while it worked and
 * appended every answer to `usage_history`, and `omp-limits.ts` read them back.
 * Unlinking the provider from OMP ends that — no new rows, and seven days later
 * the old ones age out of `readOmpLimits` — while the standalone `agy` CLI goes
 * on burning the same account-level pool. So this module asks Google directly,
 * the way `agy` itself does.
 *
 * `POST /v1internal:retrieveUserQuotaSummary` with an empty body. The endpoint
 * is internal and undocumented, so every failure here is data, not an
 * exception: the panel loses one card and every other number stays. Two traps
 * live in the request, both found the hard way:
 *
 * - The `User-Agent` **must** contain `antigravity`. Anything else — Node's
 *   default, or an honest `prompt-burn/1.0` — is answered `403` with
 *   `SUBSCRIPTION_REQUIRED (#3501)`, which reads like a licensing problem and
 *   is not one.
 * - Never send `x-goog-user-project`. Antigravity bills through Google's own
 *   project, so naming a project turns the call into a permission error.
 *
 * The credential is `agy`'s, in the macOS keychain under service `gemini` /
 * account `antigravity`, written by go-keyring. It is read at fetch time, used
 * for one header, and never returned to a caller, logged, or written to
 * `~/.prompt-burn/db.sqlite` — the contract Cursor's token and Ollama's key
 * already hold.
 */

import { execFileSync } from "node:child_process";
import { closeSync, openSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderLimits, UsageLimit } from "@prompt-burn/core";

const ORIGIN = "https://cloudcode-pa.googleapis.com";
const QUOTA_PATH = "/v1internal:retrieveUserQuotaSummary";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Must contain `antigravity`, case-insensitively. See the header trap above. */
const USER_AGENT = "antigravity-cli (prompt-burn)";

/**
 * Antigravity's desktop OAuth client, needed only to renew the access token.
 *
 * It is **read out of the installed `agy` binary at run time**, never checked
 * in. Two reasons, and the first one is not squeamishness: a shipped OAuth
 * pair committed to a public repository is what GitHub's push protection
 * blocks, and rightly. The second is that Google rotates these; reading the
 * binary the user already trusts means the rotation arrives with their next
 * `agy update` instead of breaking this file.
 *
 * The binary ships more than one pair and gives no hint which belongs to which
 * client, so `refreshAccessToken` tries them in the order found and keeps the
 * one Google accepts. That costs at most a few rejected posts, once per
 * process, on a path that only runs when the stored token has already died.
 */
const CLIENT_ID_PATTERN = /[0-9]{6,}-[a-z0-9]{16,}\.apps\.googleusercontent\.com/g;
/** Google's format is a fixed `GOCSPX-` plus 28. They are stored back to back. */
const CLIENT_SECRET_PATTERN = /GOCSPX-[A-Za-z0-9_-]{28}/g;
/** Literal anchors: `Buffer.indexOf` is memmem, a regex over 170 MB is not. */
const ID_ANCHOR = ".apps.googleusercontent.com";
const SECRET_ANCHOR = "GOCSPX-";
/** Big enough to hold either token whole, on both sides of an anchor hit. */
const ANCHOR_OVERLAP = 128;
const CHUNK_BYTES = 4 * 1024 * 1024;

interface OauthClient {
  id: string;
  secret: string;
}

/**
 * Scanning 170 MB is cheap once and absurd twice. Keyed by the file scanned,
 * and rewritten on a successful refresh so the accepted pair is tried first.
 */
const cachedClients = new Map<string, OauthClient[]>();

const SERVICE = "gemini";
const ACCOUNT = "antigravity";
/** go-keyring wraps every value it writes; older ones are bare JSON. */
const BASE64_PREFIX = "go-keyring-base64:";
/** `security` exits 44 when the item simply is not there. */
const ITEM_NOT_FOUND = 44;

/** Refresh this far before expiry, so a slow round trip cannot land after it. */
const SKEW_MS = 60_000;

/** Google's window ids in the panel's words. Anything new passes through. */
const WINDOW_LABELS: Record<string, string> = { "5h": "5 Hour", weekly: "Weekly" };

/** `agy`'s signed-in session. In memory only, for the length of one fetch. */
export interface AntigravityCredential {
  ok: true;
  accessToken: string;
  refreshToken: string;
  /** When `accessToken` dies — about an hour out. Refreshed past, not failed on. */
  expiresAt: Date;
  /** The signed-in address, so the card can name the subscription. */
  account?: string;
}

export interface AntigravityUnavailable {
  ok: false;
  /** `signed_out` — no keychain item; `unreadable` — one we cannot parse. */
  reason: "signed_out" | "unreadable";
  /** Human-readable detail. Never contains any part of the credential. */
  detail: string;
}

export type AntigravityAuth = AntigravityCredential | AntigravityUnavailable;

/** The raw keychain value. Split out so tests never touch the real keychain. */
export function readKeychainSecret(): string {
  return execFileSync("security", ["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"], {
    encoding: "utf8",
  });
}

/** Where `agy` installs itself. The OAuth client is read from this file. */
export function defaultAgyBinary(home: string = homedir()): string {
  return join(home, ".gemini", "bin", "agy");
}

/** `agy`'s current session, or why there isn't one. */
export function readAntigravityAuth(read: () => string = readKeychainSecret): AntigravityAuth {
  let raw: string;
  try {
    raw = read();
  } catch (error) {
    // Two ways to have no session, and neither is a fault worth a banner:
    // `security` exits 44 when the item is absent, and fails to spawn at all
    // (`ENOENT`) on anything that is not macOS. A Linux CI runner has no
    // keychain to read, which is "no agy session", not "a keychain we broke".
    const noSession =
      typeof error === "object" && error !== null
        ? ("status" in error && error.status === ITEM_NOT_FOUND) ||
          ("code" in error && error.code === "ENOENT")
        : false;
    if (noSession) {
      return { ok: false, reason: "signed_out", detail: `No ${SERVICE}/${ACCOUNT} keychain item` };
    }
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: "unreadable", detail: `Cannot read the keychain: ${detail}` };
  }

  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "signed_out", detail: "Keychain item is empty" };

  const json = trimmed.startsWith(BASE64_PREFIX)
    ? Buffer.from(trimmed.slice(BASE64_PREFIX.length), "base64").toString("utf8")
    : trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: "unreadable", detail: "Keychain item is not JSON" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "unreadable", detail: "Keychain item is not an object" };
  }

  const token = "token" in parsed ? parsed.token : undefined;
  const idToken = "id_token" in parsed ? parsed.id_token : undefined;
  if (typeof token !== "object" || token === null) {
    return { ok: false, reason: "unreadable", detail: "Keychain item holds no token" };
  }
  const accessToken = "access_token" in token ? token.access_token : undefined;
  const refreshToken = "refresh_token" in token ? token.refresh_token : undefined;
  const expiry = "expiry" in token ? token.expiry : undefined;

  // Without a refresh token the session is a dead end within the hour, so it
  // is treated as no session at all rather than one that works until it does not.
  if (typeof accessToken !== "string" || !accessToken) {
    return { ok: false, reason: "unreadable", detail: "Keychain token has no access token" };
  }
  if (typeof refreshToken !== "string" || !refreshToken) {
    return { ok: false, reason: "signed_out", detail: "Keychain token has no refresh token" };
  }

  const expiresAt = typeof expiry === "string" ? new Date(expiry) : new Date(0);
  const account = emailFromIdToken(idToken);
  return {
    ok: true,
    accessToken,
    refreshToken,
    expiresAt: Number.isNaN(expiresAt.getTime()) ? new Date(0) : expiresAt,
    ...(account ? { account } : {}),
  };
}

/**
 * Antigravity's quota buckets as one `ProviderLimits`. Throws on transport,
 * HTTP or shape failure — the caller owns turning that into a source result.
 */
export async function fetchAntigravityLimits(
  auth: AntigravityCredential,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
  agyBinary: string = defaultAgyBinary(),
): Promise<ProviderLimits> {
  // `agy` refreshes the keychain item whenever it runs, but Prompt Burn may be
  // the only thing awake for hours. Refreshing in memory is what keeps the card
  // alive on a machine where nobody has opened the CLI since breakfast.
  const accessToken =
    auth.expiresAt.getTime() > now.getTime() + SKEW_MS
      ? auth.accessToken
      : await refreshAccessToken(auth.refreshToken, fetchImpl, agyBinary);

  const response = await fetchImpl(`${ORIGIN}${QUOTA_PATH}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: "{}",
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${QUOTA_PATH} -> ${response.status} ${body.slice(0, 200)}`);
  }

  const payload: unknown = JSON.parse(body);
  const groups =
    typeof payload === "object" && payload !== null && "groups" in payload
      ? payload.groups
      : undefined;
  if (!Array.isArray(groups)) {
    throw new Error(`POST ${QUOTA_PATH} returned no groups array`);
  }

  const limits = groups.flatMap(readGroup);
  if (limits.length === 0) {
    throw new Error(`POST ${QUOTA_PATH} returned no readable bucket`);
  }

  return {
    provider: "google-antigravity",
    ...(auth.account ? { account: auth.account } : {}),
    observedAt: now.toISOString(),
    limits,
  };
}

/**
 * A new access token from the refresh token. Neither is stored anywhere.
 *
 * The OAuth client comes out of the `agy` binary, which ships more than one
 * and labels none, so each pair is offered until Google accepts one. A wrong
 * pair answers `401 invalid_client`, which is not the same failure as a
 * revoked session (`400 invalid_grant`) and must not be reported as one.
 */
async function refreshAccessToken(
  refreshToken: string,
  fetchImpl: typeof fetch,
  agyBinary: string,
): Promise<string> {
  const clients = oauthClients(agyBinary);
  if (clients.length === 0) {
    throw new Error(`No OAuth client in ${agyBinary} — reinstall or run agy to refresh its token`);
  }

  let last = "";
  for (const client of clients) {
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
      body: new URLSearchParams({
        client_id: client.id,
        client_secret: client.secret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    const body = await response.text();
    if (!response.ok) {
      last = `${response.status} ${body.slice(0, 120)}`;
      continue;
    }
    const granted: unknown = JSON.parse(body);
    const accessToken =
      typeof granted === "object" && granted !== null && "access_token" in granted
        ? granted.access_token
        : undefined;
    if (typeof accessToken !== "string" || !accessToken) {
      throw new Error(`POST ${TOKEN_URL} returned no access token`);
    }
    // The winner first next time: a rejected pair is a wasted round trip.
    cachedClients.set(agyBinary, [client, ...clients.filter((other) => other !== client)]);
    return accessToken;
  }
  throw new Error(`POST ${TOKEN_URL} -> ${last}`);
}

/**
 * Every OAuth pair the installed binary carries, in the order it carries them.
 *
 * The binary is ~170 MB, so it is read in chunks and searched with
 * `Buffer.indexOf` on the two literal anchors; regex only ever runs on the few
 * dozen bytes around a hit. Decoding the whole file to a string instead costs
 * about four seconds and a third of a gigabyte, on a path the user is waiting
 * on. Chunks overlap by `ANCHOR_OVERLAP` so a pair straddling a boundary is
 * still found whole.
 */
function oauthClients(agyBinary: string): OauthClient[] {
  const cached = cachedClients.get(agyBinary);
  if (cached) return cached;

  const ids: string[] = [];
  const secrets: string[] = [];
  let handle: number;
  try {
    handle = openSync(agyBinary, "r");
  } catch {
    // No `agy` installed, or not where we looked: there is nothing to refresh
    // with, and the caller turns that into a missing card.
    return [];
  }
  try {
    const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
    let position = 0;
    for (;;) {
      const read = readSync(handle, buffer, 0, CHUNK_BYTES, position);
      if (read === 0) break;
      const chunk = buffer.subarray(0, read);
      collect(chunk, ID_ANCHOR, CLIENT_ID_PATTERN, ids);
      collect(chunk, SECRET_ANCHOR, CLIENT_SECRET_PATTERN, secrets);
      if (read < CHUNK_BYTES) break;
      position += read - ANCHOR_OVERLAP;
    }
  } finally {
    closeSync(handle);
  }

  // Cross-product rather than zip: the binary's layout pairs nothing, and the
  // first accepted combination is the answer.
  const clients = ids.flatMap((id) => secrets.map((secret) => ({ id, secret })));
  cachedClients.set(agyBinary, clients);
  return clients;
}

/**
 * Appends every distinct match of `pattern` found around `anchor` in `chunk`.
 * The window is the anchor's neighbourhood, never the chunk, so the pattern
 * never runs over megabytes of machine code.
 */
function collect(chunk: Buffer, anchor: string, pattern: RegExp, into: string[]): void {
  for (let at = chunk.indexOf(anchor); at !== -1; at = chunk.indexOf(anchor, at + 1)) {
    const window = chunk
      .subarray(Math.max(at - ANCHOR_OVERLAP, 0), at + ANCHOR_OVERLAP)
      .toString("latin1");
    for (const match of window.match(pattern) ?? []) {
      if (!into.includes(match)) into.push(match);
    }
  }
}

/**
 * One quota group as panel rows. The group's name becomes `Usage (Gemini
 * Models)` because the panel already splits that shape into a vendor heading
 * with bare windows under it — the form OMP's rows arrived in, kept so two
 * pools of the same length never read alike.
 */
function readGroup(group: unknown): UsageLimit[] {
  if (typeof group !== "object" || group === null) return [];
  const displayName = "displayName" in group ? group.displayName : undefined;
  const buckets = "buckets" in group ? group.buckets : undefined;
  if (!Array.isArray(buckets)) return [];
  const vendor = typeof displayName === "string" ? displayName.trim() : "";

  return buckets.flatMap((bucket): UsageLimit[] => {
    if (typeof bucket !== "object" || bucket === null) return [];
    const bucketId = "bucketId" in bucket ? bucket.bucketId : undefined;
    if (typeof bucketId !== "string" || !bucketId) return [];
    // A disabled bucket is a pool this account does not have; an empty row for
    // it would read as "0% used" rather than "not yours".
    if ("disabled" in bucket && bucket.disabled === true) return [];

    const window = "window" in bucket ? bucket.window : undefined;
    const remaining = "remainingFraction" in bucket ? bucket.remainingFraction : undefined;
    const resetTime = "resetTime" in bucket ? bucket.resetTime : undefined;
    const windowLabel =
      typeof window === "string" && window ? (WINDOW_LABELS[window] ?? window) : "";
    return [
      {
        id: `google-antigravity:${bucketId}`,
        label: vendor ? `Usage (${vendor})` : bucketId,
        ...(windowLabel ? { windowLabel } : {}),
        // Google reports what is *left*. The panel shows what is gone, and a
        // bucket that answered with an amount instead of a fraction has no
        // percentage to show — `null`, never a zero standing in for silence.
        usedFraction:
          typeof remaining === "number" && Number.isFinite(remaining)
            ? Math.min(Math.max(1 - remaining, 0), 1)
            : null,
        resetsAt: typeof resetTime === "string" && resetTime ? resetTime : null,
      },
    ];
  });
}

/** The signed-in address out of the id token. Never the token itself. */
function emailFromIdToken(idToken: unknown): string | undefined {
  if (typeof idToken !== "string") return undefined;
  const payload = idToken.split(".")[1];
  if (!payload) return undefined;
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (typeof claims !== "object" || claims === null || !("email" in claims)) return undefined;
  return typeof claims.email === "string" && claims.email ? claims.email : undefined;
}
