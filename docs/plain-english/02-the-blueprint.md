# The blueprint

**Twin of:** [Product plan and locked decisions](../architecture/02-product-plan.md)

Prompt Burn is going to be a small program that answers one question: "if all the token work my
coding assistants did this week had been billed at the public pay-per-use rates, what would it
have cost?" The house is not built yet. What exists today is the blueprint — four documents that
describe what the tool will do, in what order it gets built, and a list of decisions that are
locked, meaning nobody is allowed to quietly change them while writing code.

The four documents, in blueprint terms: `docs/product.md` says what the thing is and why.
`docs/implementation-plan.md` says how it gets built, step by step, in thirty small steps grouped
into seven deliveries. `docs/spec.md` is the one-page crib sheet a builder keeps open while
working — it repeats the locked decisions but none of the reasoning. And `docs/data-shapes.md` is
the site survey: someone actually went and looked at the real logs and the real website data to
confirm the measurements the drawings rely on.

## The locked decisions

The most important page in all of this is a table. It pins down the things that are easy to get
wrong later:

- **Only two sources.** The tool reads OMP session logs and Cursor usage. Other assistants are
  out of scope.
- **The dollar figure is an estimate, not a bill.** Tokens are counted, then multiplied by a
  table of public pay-as-you-go prices kept on this machine. What Cursor itself says you owe is
  ignored for this number.
- **No per-account splitting.** OMP usage shows up per model, not per subscription or API key.
- **Cursor Pro reports per billing cycle only.** It gives one set of totals for the current
  cycle, so it gets a "Cycle to date" label and calendar filters don't touch it.
- **Optional enterprise key.** If an Enterprise admin key is ever provided, Cursor could report
  event-by-event times and calendar filters would work for it too. Nobody has that key, so the
  design just leaves a door open.
- **Time filters are simple and local.** Today, This month, All time, or a date range, all in the
  computer's own timezone. You pick an end day and the whole day counts.
- **No deduplication.** If the same work shows up in both OMP and Cursor, the grand total counts
  it twice. That's accepted, not hidden.
- **The model table pairs each model with each source.** The same model used in both tools
  appears as two rows.
- **Fetching only happens on open or on button press.** No background polling. While a fetch is
  running, the old numbers stay on screen — never blank, never reset to zero. If fetching fails,
  the old numbers stay and a banner says what failed.
- **Data lives at `~/.prompt-burn/db.sqlite`.** That's outside the app's own folders on purpose,
  so reinstalling or updating the app never throws your history away. The desktop app and the
  VS Code panel share the same file.
- **Usage rows store tokens, not money.** Cost is calculated fresh at display time from a price
  table with start/end dates. Add a price later and old records get priced correctly — nothing
  has to be rewritten.
- **OMP syncing is incremental.** The tool remembers where it stopped reading each session file
  and only reads what's new.
- **In VS Code it opens as a full-width editor tab**, like opening a document — not a cramped
  sidebar.
- **Local only.** Nothing leaves this machine. Cursor's login tokens are read from Cursor's own
  files when needed and never saved anywhere.

One consequence is spelled out as a promise, because it's easy to get wrong: when you look at
"Today", the OMP numbers get filtered to today but the Cursor numbers stay cycle-to-date. The
big total at the top is then the sum of two different time windows, and the screen must say so
out loud — for example, "OMP: Today · Cursor: cycle to date". It must never pretend Cursor
numbers fit into today by inventing a day-by-day breakdown that doesn't exist.

## The honest part

One of the locked decisions has been caught being wrong. The site survey (2026-09-02) proved
that Cursor's usage data does accept date windows after all — the drawings said it couldn't. On
the drawings there's now a note pinned: the builders are deliberately waiting for a decision
before changing anything, because how Cursor is filtered is a product choice, not a survey
result. Until that decision, the tool will be built the way the drawings say, which still works
correctly — it just shows less than it could. All three planning documents carry this note.

There's also a discovered limit waiting quietly: Cursor's backend refuses any date window that
crosses two specific dates in its history, so an "all time" view would need to stitch together
up to three separate queries. That fact lives only in the survey notes.

## Deliberately not being built

Projects grouping, quota tiles, a source on/off dropdown, automatic refreshing, a database
migration system, CSV export, other assistants, and a timezone setting are all explicitly
deferred. Nobody should add any of them until asked.

## What is not proven

The survey was done on one machine on one day. Some things it states are honest unknowns: the
mapping between Cursor's model names and public prices is only partly verified, Cursor's
`default` (Auto) model has real usage but no public price, so "unknown price — shown as a dash,
never as $0" is a normal state, not a rare glitch. And there is no test suite yet — every
promise on this page is enforced by humans reading documents, not by machines.