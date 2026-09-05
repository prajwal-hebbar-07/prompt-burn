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
 * Every card is data: a provider that has not answered has no card, and none
 * of them is hardcoded here.
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

/** Nested tiles sit on the panel; only Cursor carries a source-colour edge. */
const CARD = "flex h-full flex-col gap-3 rounded-control bg-surface-subtle px-3.5 py-3";

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
 *
 * Name | percent | note is a three-column grid so long Antigravity labels
 * truncate instead of shoving the number around.
 */
function LimitRow({ testId, name, fraction, note }: RowProps) {
  const nearCap = fraction !== null && fraction >= NEAR_CAP;
  return (
    <div data-testid={testId} className="flex flex-col gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_2.5rem_auto] items-baseline gap-x-2">
        <span className="truncate text-small leading-small">{name}</span>
        <span
          className={`text-right font-mono text-small leading-small font-medium tabular-nums ${nearCap ? "text-warning" : ""}`}
        >
          {fraction === null ? UNKNOWN_COST : `${Math.round(fraction * 100)}%`}
        </span>
        <span className="whitespace-nowrap text-small leading-small text-foreground-muted">
          {note ?? ""}
        </span>
      </div>
      <div
        aria-hidden="true"
        className="h-1 overflow-hidden rounded-full bg-border"
      >
        <span
          className={`animate-bar block h-full origin-left rounded-full ${nearCap ? "bg-warning" : "bg-foreground"}`}
          style={{ width: `${(fraction ?? 0) * 100}%` }}
        />
      </div>
    </div>
  );
}

/** `5 Hour` → `5-hour`, `Weekly` → `weekly` — one shape for every provider. */
function windowSlug(window: string): string {
  return window
    .trim()
    .toLowerCase()
    .replace(/(\d+)\s+/, "$1-")
    .replace(/\s+/g, "-");
}

/** Antigravity's `Usage (Google)` — the vendor, or null for everyone else. */
function usageVendor(label: string): string | null {
  return /^usage\s*\((.+)\)\s*$/i.exec(label)?.[1] ?? null;
}

/**
 * Consecutive `Usage (Google)` clocks become one Google block, so the window
 * can sit on its own row instead of repeating the vendor six times.
 */
function vendorBlocks(limits: UsageLimit[]): Array<{ vendor: string | null; limits: UsageLimit[] }> {
  const blocks: Array<{ vendor: string | null; limits: UsageLimit[] }> = [];
  for (const limit of limits) {
    const vendor = usageVendor(limit.label);
    const last = blocks.at(-1);
    if (vendor && last?.vendor === vendor) last.limits.push(limit);
    else blocks.push({ vendor, limits: [limit] });
  }
  return blocks;
}

/**
 * `5-hour`, or the provider's own words when the window is already in the
 * label. A vendor heading, when there is one, has already named the pool.
 */
function limitName(limit: UsageLimit, providerName: string, underVendor: boolean): string {
  if (underVendor && limit.windowLabel) return windowSlug(limit.windowLabel);

  const prefix = `${providerName.toLowerCase()} `;
  let label = limit.label.toLowerCase().startsWith(prefix)
    ? limit.label.slice(prefix.length).trim()
    : limit.label;
  const vendor = usageVendor(label);
  if (vendor) label = vendor;

  const window = limit.windowLabel;
  if (!window) return label;
  const slug = windowSlug(window);
  if (!label || label.toLowerCase() === window.toLowerCase() || label.toLowerCase() === slug) {
    return slug;
  }
  if (label.toLowerCase().includes(window.toLowerCase()) || label.toLowerCase().includes(slug)) {
    return label;
  }
  return `${label} · ${slug}`;
}

/** A window that has already rolled over says nothing about the one running now. */
function windowEnded(limit: UsageLimit, now: Date): boolean {
  return limit.resetsAt !== null && Date.parse(limit.resetsAt) < now.getTime();
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
      <h3 className="text-small leading-small font-semibold tracking-wide text-foreground-muted uppercase">
        {name}
      </h3>
      {accounts.map((group, index) => {
        const nearCap = group.limits.some(
          (limit) =>
            !windowEnded(limit, now) &&
            limit.usedFraction !== null &&
            limit.usedFraction >= NEAR_CAP,
        );
        const letter = String.fromCharCode(65 + index);
        const account = accountLine(group, letter, now, nearCap);
        const showAccount = accounts.length > 1 || account !== `Account ${letter}`;
        return (
          <div key={`${provider}:${index}`} className="flex flex-col gap-2">
            {showAccount ? (
              <p className={`text-small leading-small font-medium ${nearCap ? "text-warning" : ""}`}>
                {account}
              </p>
            ) : null}
            {vendorBlocks(group.limits).map((block) => (
              <div key={block.vendor ?? block.limits[0]?.id} className="flex flex-col gap-2">
                {block.vendor ? (
                  <p className="text-small leading-small font-medium">{block.vendor}</p>
                ) : null}
                {block.limits.map((limit) => {
                  const reset = limit.resetsAt ? formatShortTime(limit.resetsAt, now) : null;
                  const ended = windowEnded(limit, now);
                  return (
                    <LimitRow
                      key={limit.id}
                      testId={`limit-row-${limit.id}`}
                      name={limitName(limit, name, block.vendor !== null)}
                      // A window that has already rolled over says nothing about
                      // the one running now, so the number goes, not the row.
                      fraction={ended ? null : limit.usedFraction}
                      note={ended ? "window ended" : reset ? `resets ${reset}` : undefined}
                    />
                  );
                })}
              </div>
            ))}
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
      className="rounded-card border border-border bg-surface px-5 py-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="usage-limits-title" className="text-body leading-body font-semibold">
          Usage limits
        </h2>
        <p className="text-small leading-small text-foreground-muted">
          Provider clocks · not estimated cost · not period-filtered
        </p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {providers.map(([provider, accounts]) => (
          <ProviderCard key={provider} provider={provider} accounts={accounts} now={at} />
        ))}
        {included ? (
          // Violet is Cursor's identity token, and it always travels with text.
          <div
            data-testid="limit-card-cursor"
            className="flex h-full flex-col gap-3 rounded-control border-l-[3px] border-l-source-cursor bg-source-cursor-subtle px-3.5 py-3"
          >
            <h3 className="text-small leading-small font-semibold tracking-wide text-source-cursor uppercase">
              Cursor
            </h3>
            <p className="text-small leading-small font-medium">
              {cycle ? `This cycle · ${cycle}` : "This cycle"}
            </p>
            <div className="flex flex-col gap-2">
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
