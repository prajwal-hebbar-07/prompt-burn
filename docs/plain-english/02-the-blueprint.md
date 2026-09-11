# The blueprint

**Twin of:** [Product plan and locked decisions](../architecture/02-product-plan.md)

Prompt Burn is a small program that answers one question: "if all the token work my coding
assistants did this week had been billed at the public pay-per-use rates, what would it have
cost?" For a while this was only a blueprint — a list of documents describing what the tool will
do, in what order it gets built, and a set of decisions that are locked, meaning nobody is
allowed to quietly change them while writing code. Now the entire construction sequence has been
completed: the foundation, the framing, the living spaces, the workbench extension for your
editor, the settings controls, and the shipping line that packages the finished software are all
built, running, and released up through version 1.1.0.

The five documents, in blueprint terms: `docs/product.md` says what the building is and why.
`docs/implementation-plan.md` says how it gets built, step by step, across all phases and
deliveries. `docs/spec.md` is the one-page crib sheet a builder keeps open while working — it
repeats the locked decisions but none of the reasoning. `docs/release.md` is the packaging manual
that explains how versions are bumped and how installers are created. And `docs/data-shapes.md`
is the site survey: someone went and inspected real log files and website responses to confirm
the measurements the drawings rely on.

## Where the build stands

Every phase in the construction plan has landed. The maths (counting tokens, filtering by calendar
periods, calculating what each model would cost), the local database file in your home folder with
its price list pre-loaded, the collectors that harvest your assistant transcripts, the desktop
window with its live connection to the database, the full user interface, the direct Cursor
connection, the editor extension tab, the settings screen with live price additions, the provider
limits display, the project-by-project breakdown, and the automated release packaging line — all
of that is built and tested.

One deliberate change from the original drawings: the plan originally sketched using an external
helper library to manage the database. The builders instead used the database reader built directly
into the runtime language itself, keeping the project free of extra third-party dependencies. The
drawings were never rewritten, so the early notes and the finished house disagree on that detail,
and the built software is what counts.

## The locked decisions

The most important page in all of this is a table. It pins down the things that are easy to get
wrong later:

- **Three sources.** The tool reads assistant session logs, Claude Code transcripts, and Cursor
  usage. Assistant work using Gemini arrives inside the standard session logs, so it is counted
  there rather than as a separate fourth source.
- **The dollar figure is an estimate, not a bill.** Tokens are counted, then multiplied by a
  table of public pay-as-you-go prices kept on this machine. What Cursor itself says you owe and
  what subscription invoices charge are ignored for this number.
- **No per-account splitting of usage or costs.** Assistant usage shows up per model, not per
  subscription or API key. The one exception is the "Usage limits" panel, where a five-hour or
  weekly window belongs to one subscription: there each account is named by its email address, so
  you can see which one to use next.
- **Claude Code reads its own separate logs.** Transcripts live in its own projects directory. Its
  tokens never overlap with the other assistant logs, so both count toward the total without any
  deduplication. When both tools draw against the same paid subscription, that overlap appears
  only on the usage limits cards.
- **Cursor answers for whichever days you ask about.** Pick Today, This month, or a specific date
  range, and Cursor is asked for exactly those days, so all columns describe the same time. "All
  time" is the exception — that request cannot be answered by Cursor's service, so it shows the
  current billing cycle with a "Cycle to date" label. If the request fails or is unavailable on
  any page, Cursor falls back to the billing cycle figure, and that figure is left out of the
  filtered headline total instead of being added to a single day's work. An empty window is
  recognized as zero usage.
- **Optional enterprise key.** If an enterprise administrator key is ever provided, Cursor could
  report event-by-event timestamps, allowing calendar filters to apply across its entire history.
  The design leaves a door open for that key if it ever arrives.
- **Time filters are simple and local.** Today, This month, All time, or a custom date range, all
  calculated in your computer's own local timezone. You pick an end day and the whole day counts.
- **Combined total.** Shows all switched-on sources. If a source is switched off in settings, it
  vanishes from the screen entirely instead of lingering as a zero. No deduplication across
  sources.
- **The model table pairs each model with each source.** The same model used across different tools
  appears on separate rows.
- **Usage limits panel.** Displays provider clocks for Claude, Ollama Cloud, Google Antigravity,
  and Cursor. These numbers are quoted directly as percentages or time remaining, never converted
  into dollars, never filtered by calendar dates, and never mixed into cost totals.
- **Projects view.** A dedicated route displaying one card per working folder, biggest spender
  first, showing which folder used which models and tokens. Cursor is absent from this route
  because its summaries do not record folder paths.
- **Fetching only happens on open or on button press.** No background timers or polling. While a
  fetch is running, previous numbers stay on screen — never blanking or dropping to zero. If
  fetching encounters an error, old numbers remain and a banner explains what failed.
- **Data lives at `~/.prompt-burn/db.sqlite`.** That is outside the program's own folders on
  purpose, so reinstalling or updating the software never throws your history away. The desktop
  application and the editor extension share the same database file.
- **Usage rows store tokens, not money.** Cost is calculated fresh at display time from a price
  table with start and end validity dates. Adding a price later allows old records to be priced
  retroactively without rewriting stored history.
- **In your editor it opens as a full-width tab.** Like opening a normal document, not a cramped
  sidebar.
- **Single version number across the project.** A dedicated tool ensures that the desktop app,
  the editor extension, and the build recipes all agree on one version, with automated packaging
  for releases.
- **Local only.** Nothing leaves this machine. Login tokens are read from the tools' own local
  files when needed and never saved into the database.

One consequence remains a firm rule: when Cursor can only provide a monthly billing cycle while
you are looking at "Today", the big total at the top covers only the filtered tools. The billing
cycle number stays on its own row, and the headline subtitle explicitly notes that the cycle figure
is not in the total. A month of work is never added to a single day.

## The honest part

The site survey caught an earlier assumption being wrong: it proved that Cursor's usage data does
accept date windows after all. The software now uses those date windows, aligning daily numbers
across tools whenever possible.

There are also honest operational risks in the finished house:
- The limit clocks for Ollama Cloud and Google Antigravity rely on private, undocumented endpoints.
  If a provider changes or removes those internal endpoints, their card will simply disappear
  while the rest of the dashboard continues working normally.
- Claude Code's log parsing was designed against published format specifications rather than an
  actual transcript file generated on this machine.
- Desktop application installers are unsigned, so your operating system will display security
  warnings when you first download and launch them.
- Antigravity work performed directly through its standalone terminal tool burns account quota
  without appearing in the dashboard's cost estimate, because its session records are stored in a
  separate database that this tool does not read.
- Three separate copies of the locked decisions still exist across the planning documents, relying
  on human care rather than automated checks to stay in agreement.

## Deliberately not being built

A source dropdown menu, automatic background polling, a database migration system, CSV or JSON
data export, other coding assistants, timezone pickers, and predictive quota forecasting are all
explicitly deferred. Nobody should add any of them until asked.

## What is not proven

Some things from the survey remain honest unknowns: model name mappings for automatic model
selection have no public price, so showing an unknown price as a dash is a standard, expected
condition.

While comprehensive test suites now verify every landed component, parser, and window calculation,
what remains unverified by machine is the documentation itself: no program checks that the three
written copies of the locked-decisions table agree with one another or that links between pages
remain valid.
