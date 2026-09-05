# The blueprint

**Twin of:** [Product plan and locked decisions](../architecture/02-product-plan.md)

Prompt Burn is a small program that answers one question: "if all the token work my coding
assistants did this week had been billed at the public pay-per-use rates, what would it have
cost?" For a while this was only a blueprint — a list of documents describing what the tool will
do, in what order it gets built, and a set of decisions that are locked, meaning nobody is
allowed to quietly change them while writing code. Now the first half of the build has actually
happened: the engine room is built, and the part of the house you can see and click is still
being framed.

The four documents, in blueprint terms: `docs/product.md` says what the thing is and why.
`docs/implementation-plan.md` says how it gets built, step by step, in thirty small steps grouped
into seven deliveries. `docs/spec.md` is the one-page crib sheet a builder keeps open while
working — it repeats the locked decisions but none of the reasoning. And `docs/data-shapes.md`
is the site survey: someone actually went and looked at the real logs and the real website data
to confirm the measurements the drawings rely on.

## Where the build stands

The plan's first twelve steps are done. The maths (counting tokens, filtering by calendar
periods, working out what each model would cost), the little database in your home folder with
its price list already filled in, the reading of the assistant's own log files (including
remembering where it stopped reading each one, so nothing gets counted twice), and the desktop
app's empty window with the database connected behind it — all of that is built and tested.

What is _not_ built yet is everything the plan lists after step 12: the button that actually
triggers a fetch, the first real number on screen, and then the full interface, the Cursor side,
and the VS Code version. Opening the app today shows a placeholder page that admits as much in
writing. That is the plan working as intended — halfway through the first delivery you can
actually use.

One deliberate change from the drawings: the plan said the database would use a popular helper
library to talk to SQLite. The builders instead used the reader built into Node itself — the
language the rest of the project is written in — which means the whole project still carries no
dependencies of its own. The drawings were never edited, so the paper and the house disagree on
this one line, and the code is what counts.

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
numbers fit into today by inventing a day-by-day breakdown that doesn't exist. This promise now
lives in the built code as well as on paper: the data shape that the screen will eventually
render already carries a flag saying "these two halves cover different time windows".

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

Projects grouping, a source on/off dropdown, automatic refreshing, a database migration system,
CSV export, other assistants, and a timezone setting are all explicitly deferred. Nobody should
add any of them until asked.

Quota tiles used to be on that list and have since been built, once, in a specific shape: a
"Usage limits" panel that repeats what each provider says about its own subscription — how much
of Claude's five-hour and seven-day window each account has spent, how much of Ollama Cloud's
session and weekly allowance is gone, how much of Cursor's included allowance is used. It
quotes those numbers; it never works out a quota of its own, and they are kept well away from
the money figures so nobody reads a percentage as a price. Ollama's numbers come from an
endpoint Ollama has never documented, so that one is expected to break some day — when it
does, the card simply disappears and nothing else changes.

## What is not proven

Some things the survey states are honest unknowns: the mapping between Cursor's model names and
public prices is only partly verified, Cursor's `default` (Auto) model has real usage but no
public price, so "unknown price — shown as a dash, never as $0" is a normal state, not a rare
glitch.

The old honest line "there is no test suite yet" is no longer true — every step that has landed
came with its own tests, and they all pass. What is still enforced only by humans reading
documents is the paper itself: nothing checks that the three copies of the locked-decisions
table agree with each other, or that links between documents still point anywhere.
