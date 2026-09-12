# The file cabinet

**Twin of:** [The database (packages/db)](../architecture/05-database.md)

Every spending record Prompt Burn keeps lives in one drawer in your home folder. Not one
drawer per app, not a drawer tucked inside the program's installation — one drawer, at a fixed
spot in your home directory, that everything shares.

## Why the drawer lives in the home folder

Programs get uninstalled, updated, replaced. Anything stored inside the program's own folders
dies with it. So the drawer sits where updates can't reach: in your home folder. Upgrade the
desktop app, reinstall it, update the editor extension — open the drawer again, and every
record from before is still there. There is exactly one drawer, and every part of the program
looks in the same spot for it.

## What's in the drawer

Four folders:

- **The spending log.** One entry per chunk of token usage: which model, how many tokens went
  in, came out, were read from cache, written to cache, which project folder the work
  happened in, and which tool burned them (OMP, Cursor, Claude Code, or Antigravity's
  command-line helper). Two kinds of entries: timestamped ones (a moment when tokens were
  burned) and billing-cycle summaries (totals for a stretch of time, with no single moment —
  these are never given a made-up date). Cursor's summaries name no project folder, so they
  sit outside any project.
- **The price list.** What each model cost, per million tokens. Crucially, the price list is a
  history, not a single sticky note. When a vendor changes a price, a new line is added saying
  "this rate starts here" — the old line is closed off, not erased. So an old spending entry
  is always priced by the rate that was in effect _when it happened_, even years later. When
  you type in a new price by hand in the settings screen, it is backdated to the beginning of
  time so your existing logs and cycle summaries price immediately.
- **A bookmark.** A note of how far the record-keeping has read through each session log (for
  OMP, Claude Code, and the Antigravity helper), so it doesn't read the same pages twice.
- **The settings slip.** Small preferences — switches to turn individual tools on or off (OMP,
  Cursor, Claude Code, Antigravity), custom folder locations for each tool's session logs, and
  notes on when the last sync succeeded or failed. Your sign-in tokens for other services are
  deliberately _not_ kept here.

## The clever part: nothing stores a dollar figure

The spending log records only tokens. Costs are figured out on the spot by matching each
entry against the price-list line covering its moment. That sounds slower, but it buys
something valuable: if a rate was wrong or missing yesterday, adding the correct price today
re-prices all of yesterday's history instantly — without touching a single spending record.

And when a model simply has no published price, the estimate isn't "$0" — it's honestly blank,
shown as a dash. An unpriced model is unknown, not free.

## The price list shipped inside the app

When the drawer is created for the first time, a starter price list of 24 rates is slipped in
with it: current published rates for models from Anthropic, Ollama Cloud, Google Gemini, xAI,
Cursor, and OpenAI. These are backdated so your existing session logs price immediately — there
was no way to know what the rates were last month, so today's rates are used for everything
already on record.

Whenever you open the drawer, any starter prices added in a newer app release are automatically
slipped in if missing. Your custom rates are never touched or duplicated. If a vendor changes a
price later, the change becomes a new line in the list and history stays priced correctly.

## Changing the drawer's layout

There is still no general upgrade machinery. Two kinds of layout change have been made by hand:

1. **Adding the project folder.** When project folders were introduced after the first release,
   opening an older drawer added the new folder slot to every existing entry, left the entries
   alone, and cleared the bookmark so the next sync re-read session logs to fill in the
   project path. Entries whose session logs were long gone simply stay without a project.
2. **Widening the tool rule.** The original drawer had a strict rule that every entry came only
   from OMP or Cursor. That kind of rule cannot be edited in place once the drawer exists, so
   each time a new tool was accepted — first Claude Code, then the Antigravity helper — the
   drawer was completely rebuilt: a brand-new folder with the wider rule, all past records and
   project slots copied across, the old folder replaced, and every index tab restored. All
   existing records survived intact, both times.

Any future layout change should follow these patterns, or the drawer finally earns real
upgrade machinery.

## The honest parts

- Deepseek's peak-hours pricing (double the normal rate during certain weekday hours) isn't
  modelled, so usage in those windows under-estimates by about half.
- Cursor-side models are priced at their creators' public list rates rather than Cursor's
  subscription billing rules. Extra surcharges for massive requests (such as requests over
  200,000 tokens on Grok) are not modelled.
- Models with automatic routing (like Cursor Auto) have no published price and remain blank.
- The Antigravity helper doesn't report how much of a request it served from its own memory
  rather than fresh, so those entries are priced as if everything was fresh — a slight
  over-estimate.
- The starter prices were correct on the day they were copied; they don't pretend to know
  what prices were before that.
- Everything here runs on the database tools built into recent Node.js itself — no extra
  database software is installed, nothing extra to break.
- The whole thing is well tested: creating the drawer, reopening it without duplicate seeds,
  price boundaries ("exactly at switchover, the new rate applies"), retroactive pricing,
  settings persistence, the blank-for-unknown rule, and the older-drawer layout changes all
  have automated checks.
