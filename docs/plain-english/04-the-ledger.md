# The ledger

**Twin of:** [Core domain (types, period filter, aggregation)](../architecture/04-core-domain.md)

Every office needs a ledger: a book with standard columns, so that whatever clerk writes an
entry and whatever accountant reads it later, they are both talking about the same thing. This
package is that book. It doesn't collect anything, doesn't fetch anything, doesn't touch your
disk or the network. It defines what a "usage record" looks like, and it holds the pure
arithmetic that turns a pile of records into the numbers you see on the dashboard.

## The standard columns

A record says: which source reported it (OMP, Cursor, or Claude Code), which project folder the
session ran in (if the work belonged to a specific folder on your computer), exactly when it
happened, which model answered, and four token counts — fresh input, generated output, and the
two cache numbers. Two fields record the model's name: the name as the source spelled it, and the
tidied canonical name. Nothing is thrown away by the tidying; the raw spelling stays on the
record.

The columns are the contract. The collectors write to them, the dashboard reads from them, and
neither side may quietly change them without the other knowing.

## The calendar pages

When you pick "today" or "this month," the ledger has to decide which records belong to that
page. The natural trap is to assume a day starts at midnight UTC. It doesn't — a day starts at
_your_ midnight, wherever you are. The ledger builds its day boundaries from the local wall
clock, and it doesn't do date arithmetic by hand: to find the end of a day it asks for midnight
of the _next_ day, and lets the calendar itself sort out month lengths, leap years, and
daylight saving.

Two rules live here. First, "all time" isn't really a filter — it passes everything through,
even records whose timestamp can't be read. Second, a date range you pick is inclusive on both
ends in calendar terms: ask for Tuesday through Thursday and you get all three days, ending at
Friday's midnight.

## The name tidier

Different tools write model names with their own habits. Cursor spells model names with effort
tags attached (`-thinking-high`, `-high-fast`), while Claude Code writes them with full date
stamps attached to the end. Left alone, the same underlying model would look like three different
items in the ledger.

The name tidier strips off the trailing date stamps and collapses the effort tags so that records
from different assistants for the same model sit on the same line and can be priced from the same
rate.

The discipline is in what it _doesn't_ tidy. A tag nobody has ever seen is left alone rather
than guessed at; a prefix marking a Cursor-hosted variant is never stripped, because those
variants may price differently; and "default" — Auto, the automatic picker — passes through
untouched, because it genuinely is its own thing. A bare tag or date with no model attached is
kept verbatim. An unknown name stays visible with no price rather than vanishing into the wrong
row.

## The summing

The aggregation takes the raw inputs — timestamped records from OMP and Claude Code, running
totals from Cursor, optional price rates, and the calendar page you are viewing — and produces
the single summary the dashboard renders.

The subtle part is that the sources keep time differently. OMP and Claude Code give each record
a timestamp, so their entries obey the calendar page strictly. Cursor reports running totals per
model with no timestamps at all. But Cursor will happily total up whichever stretch of days you
ask it about, so for Today, This month, and a date range the collector asks for exactly those
days, allowing all columns to describe the same time.

"All time" is the one page it cannot narrow: the request must name specific start and end days,
and a span reaching back to the beginning of time is something Cursor's storage refuses. There
Cursor falls back to its current billing cycle, and because a billing cycle is a superset of
nothing in particular, the two scopes are treated as equivalent and both count.

The same fallback happens on any page if Cursor cannot narrow the span — an unauthenticated
session, a network refusal, or an older collection. Then Cursor is reporting a whole 30-day billing
cycle sitting beside a single day of local work. The ledger does two things about it: it flags the
mismatch so the dashboard can explain it in words, and it leaves the Cursor figure out of the
headline total entirely. Adding a month to a day would produce a number that is true of no period
at all. The cycle figure stays visible on its own subtotal line, clearly footnoted — it just isn't
mixed into the period's headline cost.

Project breakdowns follow the same discipline. Records that carried a project folder are grouped
into a project-by-project summary, ordered by spend, with unplaced records gathered into an
unattributed bucket. Cursor never enters this list because its running totals carry no folder.

When price rates are supplied, costs are looked up for each event at the exact instant it took
place. If any model in a period lacks a rate, the entire total containing it remains unknown —
which the dashboard renders as a dash, never as an inaccurate zero. A period with zero usage and
known rates reports zero, not unknown.

Finally, sources switched off in settings are left off the screen rather than appearing as zero
rows, and provider allowance meters (such as 5-hour or weekly subscription limits) pass straight
through to the limits display without being altered by calendar filters.

## The honest parts

- The name tidier was written from patterns directly observed in real accounts. It is a short
  rule list on purpose: anything unrecognized survives untouched and shows up as an unpriced
  row, instead of silently merging into something it isn't.
- The cost columns derive their numbers from a price lookup; without one, or when any rate is
  missing, "unknown" is the honest answer that prevents displaying misleading sums.
- The calendar tests run in a deliberately odd timezone whose midnight sits half an hour off the
  hour, so any mistake about "local vs world clock" shows up immediately. But your real device
  will run in its own timezone, daylight-saving shifts and all, and that exact path has been
  reasoned about rather than machine-tested.
- The second way Cursor can report — per-event records instead of cycle totals — is a reserved
  page in the book: defined, tested with made-up entries, and not yet fed by anything real.
- Projects only group tools that actually know which directory they operated in; no folders are
  invented for tools that report none.

## If you need to change it

The book has few rooms, and each change has one obvious door: a new period kind goes in the
calendar chapter with a boundary test beside it; a newly observed model tag or date format goes
on the tidying list with its example; a new data source is taught how its time is kept and
whether it knows its project folder; and changes to the dashboard summary must be made together
with the dashboard itself.
