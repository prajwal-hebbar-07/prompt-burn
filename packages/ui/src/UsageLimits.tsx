/**
 * The Usage limits panel: what each provider says is left on its own clock.
 *
 * Nothing on this panel is ours. The percentages are the providers' answers
 * about their own subscription windows — Claude's 5-hour and 7-day clocks per
 * account, Cursor's included pools — so they are never period-filtered, never
 * priced, and never mixed into the hero's estimate. That is what the caption
 * says out loud, because a percentage next to a dollar figure invites exactly
 * the wrong reading.
 *
 * A limit belongs to an account, so this is the one surface that splits by
 * account: two Claude subscriptions are two rows of clocks under one card.
 * They stay anonymous — `Account A` / `Account B` in snapshot order — since
 * which mailbox pays is not what the panel is for, and an email on screen is
 * an email in every screenshot.
 *
 * Ollama Cloud is a card with no numbers on purpose: OMP asks, and Ollama has
 * no usage endpoint to answer with. Saying so beats leaving a hole where a
 * user would assume zero.
 */

import type { DashboardSnapshot, ProviderLimits, UsageLimit } from "@prompt-burn/core";
import { formatCycleWindow, formatShortTime, UNKNOWN_COST } from "./format.js";

/** Amber from here up. The design flags 82% and leaves 41% alone. */
const NEAR_CAP = 0.8;

/**
 * How old an observation may be before the card admits its age. OMP refreshes
 * these while it works, so anything older than this means OMP has been idle,
 * and a 5-hour clock from an hour ago is not the current one.
 */
const STALE_MS = 30 * 60 * 1000;

/** OMP's provider ids, in product words. Unknown ids show their own id. */
const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Claude",
  "google-antigravity": "Antigravity",
  "ollama-cloud": "Ollama Cloud",
};

/** Product copy, not a provider message: Ollama publishes no usage API. */
const OLLAMA_NOTE =
  "Cloud usage isn’t exposed to this app yet. Check session and weekly remaining at ollama.com/settings.";

const CARD = "rounded-card border border-border bg-surface p-4";

interface RowProps {
  testId: string;
  name: string;
  /** 0–1, or `null` when the provider reported no number for this window. */
  fraction: number | null;
  /** `resets 14:20`, `of included` — whatever qualifies the percentage. */
  note?: string;
}

/**
 * One clock: name, percentage, qualifier, and a bar under all three. The bar is
 * decoration — the percentage is text, so the row survives with colour off.
 */
function LimitRow({ testId, name, fraction, note }: RowProps) {
  const nearCap = fraction !== null && fraction >= NEAR_CAP;
  return (
    <div data-testid={testId} className="mt-3 first:mt-0">
      <div className="flex items-baseline gap-2">
        <span className="text-body">{name}</span>
        <span
          className={`text-body font-semibold tabular-nums ${nearCap ? "text-warning" : ""}`}
        >
          {fraction === null ? UNKNOWN_COST : `${Math.round(fraction * 100)}%`}
        </span>
        {note ? <span className="text-small text-foreground-muted">{note}</span> : null}
      </div>
      <div
        aria-hidden="true"
        className="mt-1 h-1 overflow-hidden rounded-full bg-surface-subtle"
      >
        <span
          className={`animate-bar block h-full origin-left rounded-full ${nearCap ? "bg-warning" : "bg-foreground"}`}
          style={{ width: `${(fraction ?? 0) * 100}%` }}
        />
      </div>
    </div>
  );
}

/**
 * `5-hour`, `7-day` — the window, once the card title has already said Claude.
 * Providers that label several clocks with the same window (Antigravity's
 * per-vendor pools) keep their own label, so two rows never read alike.
 */
function limitName(limit: UsageLimit, providerName: string): string {
  const prefix = `${providerName.toLowerCase()} `;
  const label = limit.label.toLowerCase().startsWith(prefix)
    ? limit.label.slice(prefix.length).trim()
    : limit.label;
  const window = limit.windowLabel;
  if (!window) return label;
  if (label.toLowerCase() === window.toLowerCase()) {
    return window.toLowerCase().replace(/\s+/g, "-");
  }
  return label.toLowerCase().includes(window.toLowerCase()) ? label : `${label} · ${window}`;
}

/**
 * `Account A`, plus whatever the card must admit about it: that a clock is
 * nearly out, and that OMP has not refreshed these numbers in a while.
 */
function accountLine(group: ProviderLimits, letter: string, now: Date, nearCap: boolean): string {
  const parts = [`Account ${letter}`];
  if (nearCap) parts.push("near cap");
  const observed = Date.parse(group.observedAt);
  if (Number.isFinite(observed) && observed < now.getTime() - STALE_MS) {
    const time = formatShortTime(group.observedAt, now);
    if (time) parts.push(`as of ${time}`);
  }
  return parts.join(" · ");
}

interface ProviderCardProps {
  provider: string;
  accounts: ProviderLimits[];
  now: Date;
}

function ProviderCard({ provider, accounts, now }: ProviderCardProps) {
  const name = PROVIDER_NAMES[provider] ?? provider;
  return (
    <div data-testid={`limit-card-${provider}`} className={CARD}>
      <h3 className="text-small leading-small font-medium tracking-wide text-foreground-muted uppercase">
        {name}
      </h3>
      {accounts.map((group, index) => {
        const nearCap = group.limits.some(
          (limit) => limit.usedFraction !== null && limit.usedFraction >= NEAR_CAP,
        );
        return (
          <div key={`${provider}:${index}`} className="mt-3">
            <p className={`text-body font-medium ${nearCap ? "text-warning" : ""}`}>
              {accountLine(group, String.fromCharCode(65 + index), now, nearCap)}
            </p>
            <div className="mt-2">
              {group.limits.map((limit) => {
                const reset = limit.resetsAt ? formatShortTime(limit.resetsAt, now) : null;
                const ended = limit.resetsAt !== null && Date.parse(limit.resetsAt) < now.getTime();
                return (
                  <LimitRow
                    key={limit.id}
                    testId={`limit-row-${limit.id}`}
                    name={limitName(limit, name)}
                    // A window that has already rolled over says nothing about
                    // the one running now, so the number goes, not the row.
                    fraction={ended ? null : limit.usedFraction}
                    note={ended ? "window ended" : reset ? `resets ${reset}` : undefined}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export interface UsageLimitsProps {
  snapshot: DashboardSnapshot;
  /** Injectable clock for the reset labels; defaults to the wall clock. */
  now?: () => Date;
}

export function UsageLimits({ snapshot, now }: UsageLimitsProps) {
  const included = snapshot.cursor.included;
  if (snapshot.limits.length === 0 && !included) return null;

  const at = now ? now() : new Date();
  // Accounts keep snapshot order inside their provider, so the letters do too.
  const providers: Array<[string, ProviderLimits[]]> = [];
  for (const group of snapshot.limits) {
    const existing = providers.find(([provider]) => provider === group.provider);
    if (existing) existing[1].push(group);
    else providers.push([group.provider, [group]]);
  }

  const cycle = formatCycleWindow(snapshot.cursor.cycleStart, snapshot.cursor.cycleEnd);

  return (
    <section
      aria-labelledby="usage-limits-title"
      data-testid="usage-limits"
      className="rounded-card border border-border bg-surface p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="usage-limits-title" className="text-section leading-section font-semibold">
          Usage limits
        </h2>
        <p className="text-small leading-small text-foreground-muted">
          Provider clocks · not estimated cost · not period-filtered
        </p>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {providers.map(([provider, accounts]) => (
          <ProviderCard key={provider} provider={provider} accounts={accounts} now={at} />
        ))}
        {/* Only alongside the providers OMP does report: on its own it would be
            a card about a source this snapshot knows nothing about. */}
        {providers.length > 0 ? (
          <div data-testid="limit-card-ollama-cloud" className={CARD}>
            <h3 className="text-small leading-small font-medium tracking-wide text-foreground-muted uppercase">
              {PROVIDER_NAMES["ollama-cloud"]}
            </h3>
            <p className="mt-3 text-section leading-section font-semibold">Unavailable</p>
            <p className="mt-2 text-body text-foreground-secondary">{OLLAMA_NOTE}</p>
          </div>
        ) : null}
        {included ? (
          // Violet is Cursor's identity token, and it always travels with text.
          <div
            data-testid="limit-card-cursor"
            className="rounded-card border border-border border-l-2 border-l-source-cursor bg-source-cursor-subtle p-4"
          >
            <h3 className="text-small leading-small font-medium tracking-wide text-source-cursor uppercase">
              Cursor
            </h3>
            <p className="mt-3 text-body font-medium">
              {cycle ? `This cycle · ${cycle}` : "This cycle"}
            </p>
            <div className="mt-2">
              <LimitRow
                testId="limit-row-cursor-auto"
                name="Auto models"
                fraction={Math.min(included.autoPercentUsed / 100, 1)}
                note="of included"
              />
              <LimitRow
                testId="limit-row-cursor-api"
                name="API models"
                fraction={Math.min(included.apiPercentUsed / 100, 1)}
                note="of included"
              />
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
