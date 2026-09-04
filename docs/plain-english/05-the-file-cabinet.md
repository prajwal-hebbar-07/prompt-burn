# The file cabinet

**Twin of:** [The database (`packages/db`)](../architecture/05-database.md)

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
  in, came out, were read from cache, written to cache. Two kinds of entries: timestamped ones
  (a moment when tokens were burned) and billing-cycle summaries (totals for a stretch of
  time, with no single moment — these are never given a made-up date).
- **The price list.** What each model cost, per million tokens. Crucially, the price list is a
  history, not a single sticky note. When a vendor changes a price, a new line is added saying
  "this rate starts here" — the old line is closed off, not erased. So an old spending entry
  is always priced by the rate that was in effect _when it happened_, even years later.
- **A bookmark.** A note of how far the record-keeping has read through each session log, so
  it doesn't read the same pages twice.
- **The settings slip.** Small preferences — where the session logs live, when the last sync
  succeeded or failed. Your sign-in tokens for other services are deliberately _not_ kept
  here.

## The clever part: nothing stores a dollar figure

The spending log records only tokens. Costs are figured out on the spot by matching each
entry against the price-list line covering its moment. That sounds slower, but it buys
something valuable: if a rate was wrong or missing yesterday, adding the correct price today
re-prices all of yesterday's history instantly — without touching a single spending record.

And when a model simply has no published price, the estimate isn't "$0" — it's honestly blank,
shown as a dash. An unpriced model is unknown, not free.

## The price list shipped inside the app

When the drawer is created for the first time, a starter price list is slipped in with it:
current published rates for the Anthropic models and the Ollama Cloud models, read from the
vendors' price pages. These are backdated so your existing session logs price immediately —
there was no way to know what the rates were last month, so today's rates are used for
everything already on record. If a vendor changes a price later, the change becomes a new line
in the list and history stays priced correctly.

## Deleting the drawer resets everything

There is no upgrade machinery for the drawer's layout. If the layout changes in a future
version, the way to pick it up is: delete the file, and the next run builds a fresh drawer
from scratch — including a fresh copy of the starter price list. For now that's a feature,
not a gap: one user, one machine, nothing worth migrating. The day a second person has an old
drawer on disk, a real upgrade path becomes necessary.

## The honest parts

- Deepseek's peak-hours pricing (double the normal rate during certain weekday hours) isn't
  modelled, so usage in those windows under-estimates by about half.
- The starter prices were correct on the day they were copied; they don't pretend to know
  what prices were before that.
- Everything here runs on the database tools built into recent Node.js itself — no extra
  database software is installed, nothing extra to break.
- The whole thing is well tested: creating the drawer, reopening it without re-seeding,
  price boundaries ("exactly at switchover, the new rate applies"), retroactive pricing, and
  the blank-for-unknown rule all have automated checks.
