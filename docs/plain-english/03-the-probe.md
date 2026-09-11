# The probe

**Twin of:** [Data-shape spike (OMP and Cursor)](../architecture/03-data-shape-spike.md)

Before anyone built the dashboard, one small instrument was sent out to check the wells.

The dashboard's whole design rests on an assumption: that the places where your token spending
and subscription allowances are recorded actually contain the readings the design needs. Not
approximately, not "someone on the internet said so": the exact readings, with the exact field
names. If any well turned out to hold something different, the whole plan would need rethinking
before a single line of the real product was written.

So instead of building the product first, we built a probe: one small instrument, no libraries,
nothing installed. It was sent out to measure, and it came back with notes. Over time, as new
assistants and quota meters joined the workbench, more test soundings were taken. Those notes
live in `docs/data-shapes.md`, and seven small samples of what was found were cleaned up and
kept as reference files in `docs/fixtures/`.

## What the probe measured

**The OMP well.** OMP keeps a running log of every conversation, one entry per line, in a folder
of session logs under your home directory. These logs are also written for helper sessions
spawned inside a main session, tucked into subfolders — so a quick glance at the top folder would
miss them, and the probe had to look through every subfolder. Each helper session burns its own
tokens, so skipping the subfolders would silently undercount everything. The probe found the
lines that record token usage, confirmed the four numbers we need are there (fresh input,
generated output, and the two cache numbers), noted the model name, and grabbed a sample line.
A later sweep across hundreds of logs also found Gemini conversations running through Google's
models. It confirmed that the thinking tokens these models produce are already folded into the
generated output rather than billed as a fifth separate bucket, so our four-gauge counter holds.

**The Cursor well.** Here the probe had to do three things in a row. First, prove it was you:
Cursor stores a sign-in token inside its own storage on your machine, and the probe opened that
storage, looked up the single entry holding the token, and used it to identify the account — it
never printed the token, never copied it anywhere, and it was read straight from Cursor's own
storage at runtime precisely so it would never end up pasted into a shell, a file, or this
repository. Second, ask Cursor for the dates of the current billing cycle — "cycle to date" —
because surprisingly, the spending report itself does not include those dates; a separate
question has to be asked first. Third, ask for the spending report: a per-model summary of the
tokens used this cycle. Two extra courtesies turned out to be required: every request must
announce it comes from Cursor's own website address, or the server refuses with an error; and the
token numbers arrive written out as text ("7350000") rather than as numbers, with the cache
entries simply missing when they are zero.

**The quota meters.** Tokens are only half the picture; assistants also live under subscription
allowances. The probe inspected two different kinds of meters. First, OMP keeps an internal
logbook of provider allowances (like five-hour and weekly clocks), recording new snapshots
regularly. Second, Ollama runs an online meter that reports how much of your session and weekly
quota has been used. The probe verified that Ollama's numbers represent fractions of your pool,
though the meter gives no warning of the exact second a window will reset.

**The direct Antigravity well.** When the Google assistant was unlinked from OMP's internal
logbook, the probe tapped directly into Google's quota service using the desktop tool's stored
keychain credentials. It uncovered two strict requirements: the request must announce itself
using the tool's own name or Google refuses with a bogus license error, and it must never mention
a billing project. Most importantly, Google's meter reports what is *remaining* in your pool
rather than what has been consumed, so the reading has to be turned upside down before showing
how much you burned.

**The Claude Code well.** Unlike the other wells, Claude Code was surveyed from published
blueprints rather than probed with live water on this computer. Its logs repeat the project and
session on every turn and use different labels for token counts, but because no local logs were
present on this machine when surveyed, no sample jar was kept for it.

## What came back

The headline: the wells hold what the design assumed. The dashboard is viable. That was the
one question the probe existed to answer, and the answer was yes.

## One reading contradicted the plan — and the plan lost

The plan had locked in a decision: for Cursor, only whole billing cycles can be shown — no date
ranges. The probe tested that and found it wrong, at least on this account: the spending report
happily accepts a start and end date and returns the narrowed numbers. One catch: a range may
not cross either of two specific dates in Cursor's history, so an all-time view is refused.

Flagged first, then fixed. Changing the plan was a product decision — it affects labels,
banners, and which buttons make sense — so the finding sat written down and pointed at from the
planning documents until that decision was made. It was made on 7 September 2026, after the
reading was re-taken and still held: the dashboard now asks Cursor for the days you picked.
All-time still shows the billing cycle, because that is the one request Cursor refuses, and the
three-requests-stitched-together workaround leans on two dates that only exist inside an error
message — not something worth writing into the code.

A further sounding on an idle day answered another question: what happens when no tokens were
burned during the requested window? Cursor simply returns a completely empty report with no model
rows. The reader was taught that an empty response means zero spending, not a broken connection.

## The honest parts

- The probe sampled, it did not audit. It looked at fresh session logs, recent cycles, and
  immediate quota readings. It did not check every old log or every historical cycle.
- The model names on the Cursor side come with tags like "-thinking-high" attached, and only a
  handful were ever seen. The rules for tidying them into proper model names are educated guesses
  until more data arrives.
- One Cursor entry is labelled "default" — that is Auto, the automatic model picker. It racks up
  real tokens but has no public price, so the dashboard will show it with no cost estimate. That
  is a normal state, not a glitch.
- Claude Code is unverified on this machine. Everything known about its diaries comes from
  blueprints; the first person running it on this machine should verify the readings against a
  real transcript.
- Ollama's usage meter is undocumented and could change without notice. Its readings are treated
  as fractions based on observed samples, but no official handbook exists for them.
- Google's quota meter requires delicate handling: it insists on the desktop tool's signature,
  refuses project headers, and reports remaining capacity instead of used capacity.
- The probe can also dump raw, unredacted copies of everything it saw into a scratch folder —
  useful for making more samples, dangerous if committed carelessly. The samples kept in the
  repo were scrubbed of private keys, emails, paths, and conversation text first; any new one must
  be too.
