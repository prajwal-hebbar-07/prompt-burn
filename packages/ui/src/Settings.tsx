/**
 * Settings screen: sources (OMP + Cursor), pricing (bundled rates + unknown models),
 * and about (local SQLite database path).
 *
 * Display only in this commit: inputs and toggles accept in-memory changes so
 * they can be verified, but nothing persists to disk, database, or sidecar.
 * Writes land in commit 28.
 *
 * No Projects, no quota/usage-limit tiles.
 */

import { useState } from "react";
import type { DashboardSnapshot } from "@prompt-burn/core";

export interface PriceRate {
  model: string;
  provider?: string;
  inputPerMtok: number;
  outputPerMtok: number;
  cacheReadPerMtok?: number | null;
  cacheWritePerMtok?: number | null;
}

export interface SourceHealth {
  source: "omp" | "cursor";
  available: boolean;
  detail?: string;
}

export interface SettingsProps {
  snapshot?: DashboardSnapshot;
  /** Unknown models override; defaults to unpriced models from `snapshot.models` */
  unknownModels?: string[];
  /** Bundled price rates passed by the host */
  bundledPrices?: PriceRate[];
  /** OMP path override value; defaults to `~/.omp/agent/sessions/` */
  ompPath?: string;
  /** OMP enabled state; defaults to true */
  ompEnabled?: boolean;
  /** Cursor enabled state; defaults to true */
  cursorEnabled?: boolean;
  /** Optional crsr_ key placeholder/value */
  cursorKey?: string;
  /** Source health status */
  health?: SourceHealth[];
  /** Database path; defaults to `~/.prompt-burn/db.sqlite` */
  databasePath?: string;
}

const DEFAULT_OMP_PATH = "~/.omp/agent/sessions/";
const DEFAULT_DB_PATH = "~/.prompt-burn/db.sqlite";

function formatRate(dollars: number | null | undefined): string {
  if (dollars === null || dollars === undefined) return "—";
  return `$${dollars.toFixed(2)}`;
}

export function Settings({
  snapshot,
  unknownModels,
  bundledPrices = [],
  ompPath: initialOmpPath = DEFAULT_OMP_PATH,
  ompEnabled: initialOmpEnabled = true,
  cursorEnabled: initialCursorEnabled = true,
  cursorKey: initialCursorKey = "",
  health = [],
  databasePath = DEFAULT_DB_PATH,
}: SettingsProps) {
  // In-memory view state only — nothing writes to disk or database.
  const [ompEnabled, setOmpEnabled] = useState(initialOmpEnabled);
  const [ompPath, setOmpPath] = useState(initialOmpPath);
  const [cursorEnabled, setCursorEnabled] = useState(initialCursorEnabled);
  const [cursorKey, setCursorKey] = useState(initialCursorKey);

  const ompHealth = health.find((h) => h.source === "omp") ?? {
    available: true,
    detail: "Available",
  };

  const isEnterprise = snapshot?.cursor.mode === "events";
  const cursorStatus = isEnterprise ? "Enterprise" : "Pro (cycle-to-date)";

  // Derive unknown models from snapshot if not explicitly provided.
  const unpricedModels =
    unknownModels ??
    Array.from(
      new Set(
        snapshot?.models.filter((m) => m.estimatedCents === null).map((m) => m.model) ?? [],
      ),
    );

  return (
    <div className="flex flex-col gap-6" data-testid="settings-screen">
      <div>
        <h2 id="settings-heading" className="text-section leading-section font-semibold">
          Settings
        </h2>
        <p className="mt-1 text-small leading-small text-foreground-muted">
          Local configuration and pricing. Values stay on this device.
        </p>
      </div>

      {/* Sources section */}
      <section
        aria-labelledby="sources-heading"
        className="rounded-card border border-border bg-surface p-6"
      >
        <h3 id="sources-heading" className="text-section font-semibold">
          Sources
        </h3>

        <div className="mt-4 flex flex-col gap-6">
          {/* OMP */}
          <div data-testid="settings-omp" className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="size-2 rounded-full bg-source-omp" />
                <span className="text-body font-medium">Oh My Pi (OMP)</span>
              </div>
              <label className="flex items-center gap-2 text-small font-medium cursor-pointer">
                <input
                  type="checkbox"
                  aria-label="Enable OMP"
                  checked={ompEnabled}
                  onChange={(e) => setOmpEnabled(e.target.checked)}
                  className="rounded-control border-border text-brand focus:ring-brand"
                />
                <span>{ompEnabled ? "Enabled" : "Disabled"}</span>
              </label>
            </div>

            <div>
              <label className="block text-small text-foreground-secondary">
                Sessions directory
                <input
                  type="text"
                  aria-label="OMP sessions path"
                  value={ompPath}
                  onChange={(e) => setOmpPath(e.target.value)}
                  className="mt-1 w-full rounded-control border border-border px-3 py-1.5 font-mono text-small text-foreground"
                />
              </label>
              <span className="mt-1 block text-table text-foreground-muted">
                Default: {DEFAULT_OMP_PATH}
              </span>
            </div>

            <div className="text-small text-foreground-muted">
              Health:{" "}
              <span data-testid="omp-health" className="text-foreground-secondary">
                {ompHealth.detail ?? (ompHealth.available ? "Available" : "Unavailable")}
              </span>
            </div>
          </div>

          <div className="border-t border-border pt-6" />

          {/* Cursor */}
          <div data-testid="settings-cursor" className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span aria-hidden="true" className="size-2 rounded-full bg-source-cursor" />
                <span className="text-body font-medium">Cursor</span>
              </div>
              <label className="flex items-center gap-2 text-small font-medium cursor-pointer">
                <input
                  type="checkbox"
                  aria-label="Enable Cursor"
                  checked={cursorEnabled}
                  onChange={(e) => setCursorEnabled(e.target.checked)}
                  className="rounded-control border-border text-brand focus:ring-brand"
                />
                <span>{cursorEnabled ? "Enabled" : "Disabled"}</span>
              </label>
            </div>

            <div className="text-small text-foreground-secondary">
              Status:{" "}
              <span data-testid="cursor-status" className="font-medium">
                {cursorStatus}
              </span>
            </div>

            <div>
              <label className="block text-small text-foreground-secondary">
                Enterprise API key (optional)
                <input
                  type="password"
                  aria-label="Cursor Enterprise API key"
                  placeholder="crsr_..."
                  value={cursorKey}
                  onChange={(e) => setCursorKey(e.target.value)}
                  className="mt-1 w-full rounded-control border border-border px-3 py-1.5 font-mono text-small text-foreground"
                />
              </label>
              <span className="mt-1 block text-table text-foreground-muted">
                Unlocks event-level Cursor usage and calendar date filtering. Display only — not saved.
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing section */}
      <section
        aria-labelledby="pricing-heading"
        className="rounded-card border border-border bg-surface p-6"
      >
        <h3 id="pricing-heading" className="text-section font-semibold">
          Pricing
        </h3>

        {/* Unknown models */}
        <div className="mt-4">
          <h4 className="text-small font-medium uppercase tracking-wide text-foreground-muted">
            Unknown models
          </h4>
          <p className="mt-1 text-small text-foreground-secondary">
            Models detected in usage logs with no rate entry. Adding a rate retroactively prices historical events.
          </p>

          {unpricedModels.length > 0 ? (
            <div data-testid="unknown-models" className="mt-3 divide-y divide-border border-t border-b border-border">
              {unpricedModels.map((model) => (
                <div key={model} className="flex items-center justify-between py-2">
                  <span className="font-mono text-small text-foreground">{model}</span>
                  <button
                    type="button"
                    aria-label={`Add price for ${model}`}
                    className="rounded-control border border-brand bg-brand-subtle px-2.5 py-1 text-small font-medium text-brand"
                  >
                    Add price
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p data-testid="no-unknown-models" className="mt-2 text-small text-foreground-muted">
              No unknown models to price.
            </p>
          )}
        </div>

        {/* Bundled rates */}
        <div className="mt-6 border-t border-border pt-4">
          <h4 className="text-small font-medium uppercase tracking-wide text-foreground-muted">
            Bundled rates
          </h4>
          <p className="mt-1 text-small text-foreground-secondary">
            Versioned public pay-as-you-go rates seeded into the database.
          </p>

          {bundledPrices.length > 0 ? (
            <table data-testid="bundled-rates-table" className="mt-3 w-full border-collapse text-small">
              <thead>
                <tr className="border-b border-border text-left text-table font-medium uppercase tracking-wide text-foreground-muted">
                  <th scope="col" className="py-2">Model</th>
                  <th scope="col" className="py-2">Provider</th>
                  <th scope="col" className="py-2 text-right">In / 1M</th>
                  <th scope="col" className="py-2 text-right">Out / 1M</th>
                  <th scope="col" className="py-2 text-right">Cache R / 1M</th>
                  <th scope="col" className="py-2 text-right">Cache W / 1M</th>
                </tr>
              </thead>
              <tbody>
                {bundledPrices.map((rate) => (
                  <tr key={`${rate.provider ?? ""}:${rate.model}`} className="border-b border-border last:border-0">
                    <td className="py-2 font-mono text-small">{rate.model}</td>
                    <td className="py-2 text-foreground-secondary">{rate.provider ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums">{formatRate(rate.inputPerMtok)}</td>
                    <td className="py-2 text-right tabular-nums">{formatRate(rate.outputPerMtok)}</td>
                    <td className="py-2 text-right tabular-nums">{formatRate(rate.cacheReadPerMtok)}</td>
                    <td className="py-2 text-right tabular-nums">{formatRate(rate.cacheWritePerMtok)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-2 text-small text-foreground-muted">
              Bundled rates for Claude and Ollama Cloud are seeded on initial database creation.
            </p>
          )}
        </div>
      </section>

      {/* About section */}
      <section
        aria-labelledby="about-heading"
        className="rounded-card border border-border bg-surface p-6"
      >
        <h3 id="about-heading" className="text-section font-semibold">
          About
        </h3>
        <p className="mt-2 text-body text-foreground-secondary">
          Prompt Burn is a local-only desktop dashboard for AI coding token usage. Dollar labels are
          for comparison at public pay-as-you-go rates, not invoices. Nothing leaves this device.
        </p>
        <div className="mt-4 flex flex-col gap-1 text-small">
          <span className="text-foreground-muted">Database</span>
          <code data-testid="db-path" className="font-mono text-small text-foreground">
            {databasePath}
          </code>
          <span className="text-table text-foreground-muted">
            SQLite database persists across reinstalls and updates.
          </span>
        </div>
      </section>
    </div>
  );
}
