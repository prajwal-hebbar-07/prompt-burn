# The switchboard

**Twin of:** [Usage reader (packages/reader)](../architecture/09-usage-reader.md)

Prompt Burn has two front doors: a standalone window on your desktop and an extension inside your
code editor. Both doors want to show you the same numbers, the same toggles, and the same spending
reports. But neither door goes digging through the back storage rooms or placing outside telephone
calls on its own.

Instead, both front doors pick up the internal phone and speak to the switchboard. The switchboard
is the central coordinator that sits between the front desks and the back offices. It knows where
the filing cabinets are kept, when to send runners out to collect session diaries, when to send a
telegram to an outside service, and how to turn piles of raw numbers into a clean summary.

## The morning roll call

When you launch an app or press refresh, the switchboard sounds the roll call. It sends runners to
gather local diaries from your computer's disk, and it places outside telephone calls to retrieve
billing statements and subscription meters.

If an outside wire goes dead — for instance, if an external service is temporarily unreachable —
the switchboard does not panic or cancel the harvest. It accepts whatever reports arrived safely,
files the local diary entries into the central cabinets, and notes the bad line on its tally sheet.
The good numbers appear on your screen immediately. An error on one line never prevents the rest of
your data from showing up.

And if you have simply never signed into a service or don't have it installed, the switchboard
treats that as normal everyday business, not an emergency. It reports that the line is quiet and
moves on.

## Answering the big question: "What did we spend today?"

When you ask the switchboard for a report, you usually don't want an undifferentiated heap of every
token you have ever used. You want to know what happened today, or this week, or this month.

For local assistant diaries, answering this is straightforward: every turn has a date and time
stamped on it, so the switchboard simply pulls the cards that fall inside the calendar window.

Outside services are trickier. By default, they send a single summary covering an entire monthly
billing cycle. If you ask the switchboard for "today", it doesn't just hand you that monthly bill.
Instead, it sends a specialized telegram asking: "Send us only the usage recorded between midnight
and right now."

When that answer arrives, the switchboard jots it down on a scratchpad on the operator's desk. If
you switch between views or ask for today's summary three times in one minute, the switchboard
reads the scratchpad instead of placing three separate long-distance calls. But the moment you
request a fresh harvest, that scratchpad is torn off and thrown away — because today has moved
forward, more tokens have burned, and old notes are no longer current.

## When the wires fail: keeping mismatched clocks apart

What happens if that outside telegram fails because the network is down? Or what if you ask for
"all time," where a single day's window cannot be defined?

In those cases, the switchboard still has the monthly billing statement on file, and it is still
worth showing. But the switchboard is strictly honest: it refuses to add a thirty-day bill to a
one-day local diary and pretend the sum is what you burned today.

Instead, it separates the numbers. It displays the monthly statement on its own line, clearly
labeled as a billing cycle. Then, it leaves that monthly figure out of the combined day total.
Your headline summary reflects only the local diaries that actually happened today, rather than an
inflated mixture of mismatched timeframes.

And if you worked in an editor all day without touching a particular outside model, the outside
service returns an empty answer. The switchboard recognizes that as a genuine zero, rather than
confusing an idle day with the entire monthly bill.

## Working out costs on the fly

The filing cabinets in the back room never store dollar figures. They store token counts.

When the switchboard prepares a report, it takes each entry and looks up its price in a master rate
book based on the exact moment the work took place. That way, if a price was missing yesterday and
you write the correct rate into the book today, the switchboard re-prices all of yesterday's work
instantly on the next report. No historical records in the filing cabinets ever need to be erased or
rewritten.

If an assistant model has no published price anywhere in the book, the switchboard doesn't pretend
the cost was zero. It leaves the estimate blank, displaying a dash. An unpriced tool is unknown,
not free.

## The bulletin board for subscription meters

Beyond token counts, the switchboard tracks the health and limits of your subscriptions — how many
hours remain on a quota, or when a weekly allowance resets.

Sometimes, both an old local log and a live outside line report on the very same subscription. The
switchboard knows better than to pin two competing cards to the bulletin board for one account.
The fresh, live report always takes priority, and the aging local note is quietly removed.

## Shared settings between two doors

If you flip a switch at the desktop front door — say, turning off an assistant you aren't currently
using — the switchboard records that choice in the central ledger.

When you walk over to the editor front door, the assistant is already turned off there too. Its
past entries are still preserved safely in the cabinets, but the switchboard leaves them off the
display until you choose to switch the tool back on. Both doors always see the exact same
preferences.

## Honest parts

- **Scratchpads vanish when the building closes.** The switchboard keeps its cached monthly
  summaries, temporary daily notes, and live subscription meters only in memory. If you close the
  program or reload the window, the operator's desk is wiped clean. The screens will show an empty
  outside section until a new harvest runs.
- **Silent fallback on failed telegrams.** If an outside service fails to deliver today's narrowed
  window, the switchboard quietly falls back to the monthly bill. It keeps the numbers honest by
  separating them, but it sounds no alarm bells explaining why the daily breakdown could not be
  retrieved.
- **Prices are looked up one line at a time.** The switchboard checks the price book for each
  individual entry in your log. When your history reaches tens of thousands of turns, flipping
  through the rate book entry by entry will take noticeable time unless the switchboard learns to
  keep a pricing shortcut sheet.
- **Outside summaries lack timestamps.** Monthly summaries from outside services don't come with
  individual timestamps for each turn. The switchboard prices them using the current rate in
  effect right now. If a service changes its rates in the middle of a billing cycle, earlier turns
  in that cycle will be priced at the newer rate.
- **No active guard between the doors.** While both doors read the central ledger before answering
  a question, the switchboard has no automatic bell to notify one door when the other changes a
  setting. The second door discovers the change the next time you interact with it.
