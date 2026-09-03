# The probe

**Twin of:** [Data-shape spike (OMP and Cursor)](../architecture/03-data-shape-spike.md)

Before anyone built the dashboard, one small instrument was sent out to check the wells.

The dashboard's whole design rests on an assumption: that the two places where your token
spending is recorded — OMP's session logs and Cursor's own accounting — actually contain the
readings the design needs. Not approximately, not "someone on the internet said so": the exact
readings, with the exact field names. If either well turned out to hold something different,
the whole plan would need rethinking before a single line of the real product was written.

So instead of building the product, we built a probe: one small script, no libraries, nothing
installed. It was sent out once, it measured, and it came back with notes. Those notes live in
`docs/data-shapes.md`, and three small samples of what it found were cleaned up and kept as
files in `docs/fixtures/`.

## What the probe measured

**The OMP well.** OMP keeps a running log of every conversation, one entry per line, in a
folder of session logs under your home directory. These logs are also written for helper
sessions spawned inside a main session, tucked into subfolders — so a quick glance at the top
folder would miss them, and the probe had to look through every subfolder. Each helper session
burns its own tokens, so skipping the subfolders would silently undercount everything. The
probe found the lines that record token usage, confirmed the four numbers we need are there
(fresh input, generated output, and the two cache numbers), noted the model name, and grabbed
one sample line.

**The Cursor well.** Here the probe had to do three things in a row. First, prove it was you:
Cursor stores a sign-in token inside its own storage on your machine, and the probe opened
that storage, looked up the single entry holding the token, and used it to identify the
account — it never printed the token, never copied it anywhere, and it was read straight from
Cursor's own storage at runtime precisely so it would never end up pasted into a shell, a
file, or this repository. Second, ask Cursor for the dates of the current billing cycle —
"cycle to date" — because surprisingly, the spending report itself does not include those
dates; a separate question has to be asked first. Third, ask for the spending report: a
per-model summary of the tokens used this cycle. Two extra courtesies turned out to be
required: every request must announce it comes from Cursor's own website address, or the
server refuses with an error; and the token numbers arrive written out as text ("7350000")
rather than as numbers, with the cache entries simply missing when they are zero.

## What came back

The headline: both wells hold what the design assumed. The dashboard is viable. That was the
one question the probe existed to answer, and the answer was yes.

## But one reading contradicts the plan

The plan had locked in a decision: for Cursor, only whole billing cycles can be shown — no
date ranges. The probe tested that and found it wrong, at least on this account: the spending
report happily accepts a start and end date and returns the narrowed numbers. One catch: a
range may not cross either of two specific dates in Cursor's history, so an all-time view
would need up to three separate requests stitched together.

Flagged, not fixed. Changing the plan is a product decision — it affects labels, banners, and
which buttons make sense — so the finding was written down and pointed to from the planning
documents, and for now the dashboard will be built cycle-only anyway. The narrow version is
correct whether or not the wider one ever ships.

## The honest parts

- The probe sampled, it did not audit. It looked at the newest session log with usable
  numbers and one billing cycle. It did not check every old log or every month.
- The model names on the Cursor side come with tags like "-thinking-high" attached, and only a
  handful were ever seen. The rules for tidying them into proper model names are educated
  guesses until more data arrives.
- One Cursor entry is labelled "default" — that is Auto, the automatic model picker. It racks
  up real tokens but has no public price, so the dashboard will show it with no cost estimate.
  That is a normal state, not a glitch.
- There are no tests. None anywhere in the project. The probe was run once, by hand, on one
  machine, and its notes are the record. Nothing here is checked automatically; if OMP or
  Cursor changes their formats, nothing will catch it except a person re-running the probe.
- The probe can also dump raw, unredacted copies of everything it saw into a scratch folder —
  useful for making more samples, dangerous if committed carelessly. The samples kept in the
  repo were redacted first; any new one must be too.