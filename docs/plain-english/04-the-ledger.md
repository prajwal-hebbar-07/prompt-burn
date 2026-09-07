# The ledger

**Twin of:** [Core domain (types, period filter, aggregation)](../architecture/04-core-domain.md)

Every office needs a ledger: a book with standard columns, so that whatever clerk writes an
entry and whatever accountant reads it later, they are both talking about the same thing. This
package is that book. It doesn't collect anything, doesn't fetch anything, doesn't touch your
disk or the network. It defines what a "usage record" looks like, and it holds the pure
arithmetic that turns a pile of records into the numbers you see on the dashboard.

## The standard columns

A record says: which machine did the work, which source reported it (OMP or Cursor), exactly
when it happened, which model answered, and four token counts — fresh input, generated output,
and the two cache numbers. Two fields record the model's name: the name as the source spelled
it, and the tidied canonical name. Nothing is thrown away by the tidying; the raw spelling
stays on the record.

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

Cursor spells model names with effort tags attached — the same underlying model can arrive
wearing a suffix, while OMP writes it bare. The ledger keeps a short list of exactly two such
tags and collapses them, so the Cursor entry and the OMP entry can sit on the same line and be
priced from the same rate.

The discipline is in what it _doesn't_ tidy. A tag nobody has ever seen is left alone rather
than guessed at; a prefix marking a Cursor-hosted variant is never stripped, because those
variants may price differently; and "default" — Auto, the automatic picker — passes through
untouched, because it genuinely is its own thing. An unknown name stays visible with no price
rather than vanishing into the wrong row.

## The summing

The aggregation takes three inputs — OMP's timestamped records, whatever Cursor reports, and
the calendar page you're viewing — and produces the one shape the dashboard renders.

The subtle part is that the two sources keep time differently. OMP gives each record a
timestamp, so its entries obey the calendar page strictly. Cursor reports running totals per
model with no timestamps at all — but it will happily total up whichever stretch of days you
ask it about, so for Today, This month and a date range the collector asks for exactly those
days and both columns end up describing the same time.

"All time" is the one page it refuses: the request has to name a start and an end, and a span
reaching back to the beginning crosses a line Cursor's own storage won't cross. There the
Cursor column falls back to the current billing cycle, and since a billing cycle is a superset
of nothing in particular, the two scopes are treated as equivalent and both are counted.

The same fallback happens on any page if the request fails — no signed-in Cursor, a network
error, a refusal. Then the Cursor column is a whole billing cycle sitting next to one day of
OMP work, and the ledger does two things about it: it flags the mismatch so the dashboard can
say so in words, and it leaves the Cursor figure out of the headline total entirely. Adding a
month to a day would produce a number that is true of no period at all. The cycle figure stays
visible on its own line, clearly labelled — it just isn't added in.

Two other honest habits. The same model appearing from both sources is deliberately two rows —
the row key is the pair of source _and_ model, so nothing from OMP is ever blended into a
Cursor number. And no costs are calculated in this book at all; every cost field starts as
"unknown," which the dashboard renders as a dash, never as a confident zero.

## The honest parts

- The two-effort-tag tidier was written from six names observed on one account. It is a short
  rule list on purpose: anything unrecognized survives untouched and shows up as an
  unpriced row, instead of silently merging into something it isn't.
- The cost columns are placeholders for now — the price book exists elsewhere but isn't wired
  in yet. "Unknown" is the correct reading of every dash until that wiring happens.
- The calendar tests run in a deliberately odd timezone whose midnight sits half an hour off
  the hour, so any mistake about "local vs world clock" shows up immediately. But your real
  device will run in its own timezone, daylight-saving shifts and all, and that exact path has
  been reasoned about rather than machine-tested.
- The second way Cursor can report — per-event records instead of cycle totals — is a reserved
  page in the book: defined, tested with made-up entries, and not yet fed by anything real.

## If you need to change it

The book has few rooms, and each change has one obvious door: a new period kind goes in the
calendar chapter with a boundary test beside it; a newly observed model tag goes on the short
tidying list with its example; a new data source is the big one, because the summing currently
knows exactly two sources and would need to learn a third. The dashboard's shape is a frozen
contract — changing it means changing the dashboard in the same breath, never alone.
