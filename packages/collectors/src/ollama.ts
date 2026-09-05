/**
 * Ollama Cloud's session and weekly clocks.
 *
 * `GET https://ollama.com/api/usage` with the API key `ollama login` stored in
 * OMP's agent database. The endpoint is **undocumented** — it is what the
 * ollama.com dashboard itself reads, and three open requests ask Ollama for a
 * supported one (ollama/ollama #15132, #15663, #16448). So every failure here
 * is data, not an exception: if the path moves, the panel loses its Ollama card
 * and nothing else breaks.
 *
 * The key is read at fetch time, used for one header, and never returned,
 * logged, or written to our database — the same contract as Cursor's token.
 *
 * `activity.cost` is Ollama's own dollar figure and is ignored for the reason
 * Cursor's `totalCents` is: cost is ours to compute from tokens × published
 * rates. The per-model `request_count` lists are not tokens either, and the
 * panel has no room for them.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { ProviderLimits } from "@prompt-burn/core";
import { ompAgentDatabase } from "./omp-limits.js";

const ORIGIN = "https://ollama.com";
const USAGE_PATH = "/api/usage";

/**
 * The two clocks the dashboard shows, in its order. Ollama's own words are
 * "session" and "weekly"; the 5-hour / 7-day cadence behind them is documented
 * nowhere in the payload, so it is not claimed here.
 */
const WINDOWS = [
  { field: "session", id: "ollama-cloud:session", label: "Ollama Cloud Session" },
  { field: "weekly", id: "ollama-cloud:weekly", label: "Ollama Cloud Weekly" },
] as const;

/**
 * The Ollama Cloud API key OMP holds, or `undefined` when there is none to
 * hold: no OMP install, no `ollama login`, or a credential OMP has disabled.
 */
export function readOllamaKey(databaseFile: string = ompAgentDatabase()): string | undefined {
  if (!existsSync(databaseFile)) return undefined;
  try {
    const db = new DatabaseSync(`file:${databaseFile}?mode=ro`, { readOnly: true });
    try {
      const row = db
        .prepare(
          `SELECT data FROM auth_credentials
            WHERE provider = 'ollama-cloud' AND disabled_cause IS NULL
            ORDER BY updated_at DESC LIMIT 1`,
        )
        .get();
      const data = row?.["data"];
      if (typeof data !== "string") return undefined;
      const { key } = JSON.parse(data) as { key?: unknown };
      return typeof key === "string" && key.length > 0 ? key : undefined;
    } finally {
      db.close();
    }
  } catch {
    // An OMP older than the credential store, or a file we cannot read.
    return undefined;
  }
}

/**
 * Ollama Cloud's two clocks as one `ProviderLimits`. Throws on transport, HTTP
 * or shape failure — the caller owns turning that into a per-source result.
 */
export async function fetchOllamaLimits(
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ProviderLimits> {
  const response = await fetchImpl(`${ORIGIN}${USAGE_PATH}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  const body = await response.text();
  if (!response.ok) {
    // 401 is the signed-out shape: the stored key no longer works.
    throw new Error(`GET ${USAGE_PATH} -> ${response.status} ${body.slice(0, 200)}`);
  }

  const { limits } = JSON.parse(body) as { limits?: unknown };
  if (typeof limits !== "object" || limits === null) {
    throw new Error(`GET ${USAGE_PATH} returned no limits object`);
  }

  const clocks = WINDOWS.flatMap(({ field, id, label }) => {
    const clock = (limits as Record<string, unknown>)[field];
    if (typeof clock !== "object" || clock === null) return [];
    const { usage } = clock as { usage?: unknown };
    if (typeof usage !== "number" || !Number.isFinite(usage)) return [];
    return [
      {
        id,
        label,
        windowLabel: field === "session" ? "Session" : "Weekly",
        // Observed 0–1 (0.037 session / 0.358 weekly against 27 and 2147
        // requests), so this is a fraction, not a percent. Clamped either way.
        usedFraction: Math.min(Math.max(usage, 0), 1),
        // Ollama sends no reset instant. The window's own cadence is public
        // (5 hours, 7 days) but the moment it turns over is not, and a clock
        // this app computed would be a guess wearing a provider's clothes.
        resetsAt: null,
      },
    ];
  });

  if (clocks.length === 0) {
    throw new Error(`GET ${USAGE_PATH} returned neither a session nor a weekly clock`);
  }

  return { provider: "ollama-cloud", observedAt: new Date().toISOString(), limits: clocks };
}
