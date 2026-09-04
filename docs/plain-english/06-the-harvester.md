# The harvester

**Twin of:** [OMP collector (`packages/collectors`)](../architecture/06-omp-collector.md)

Every conversation you have with OMP is written down as it happens — a running diary in a
folder on your machine, one line per entry, including separate diaries for the helper
sessions that get spawned alongside the main one. Each helper burns its own tokens, so a
harvester that only read the top of the folder would quietly undercount everything.

This is the harvester. It walks that folder — every subfolder — and after each conversation
turn where the assistant spoke, it reads four numbers off the page: fresh input, generated
output, and the two cache numbers. It notes which model did the talking, when it happened,
and which session it belonged to. That is all it takes. It is not interested in anything
else the diary mentions — not what anyone said, not OMP's own guess at the dollar cost.
The money is worked out later, from a price list, so that old entries can be re-priced if
prices change. Storing OMP's own estimate would fight that.

## How it avoids counting things twice

The harvester keeps a private notebook. For every diary it has read, the notebook records
the last time the diary changed and how far into it the harvester read.

Before reading a diary, it checks the notebook. If the diary hasn't been touched since
last time and the harvester already read to the end, the diary isn't even opened. That's
what makes the second pass cheap.

If the diary grew — the session is still live — the harvester picks up where it left off.
If the diary shrank, it was rewritten, not extended, so the harvester starts over from the
first page.

One subtlety: a diary being written right now might have its last line half-finished. The
harvester only counts a line once it's sure the line ended properly; a torn last line is
left for next time, so nothing is lost or double-counted.

## How it avoids logging the same event twice

Each entry gets a name built from the session it lives in plus its own id within that
session — a name that comes out the same every time the same entry is read. The logbook
refuses to write two entries with the same name. So if a file is re-read by accident, or
two copies of it are found, the second attempt simply doesn't stick. A summary at the end
tells you how many files were read, how many were skipped as unchanged, and how many new
entries actually landed.

There's a fallback: a diary with no proper first page can't provide a session name, so the
entries there get named by where they sit in the file instead. It's a weaker guarantee,
but still stable across re-reads, and it never collapses two different entries into one.

## What it doesn't do

It doesn't talk to Cursor at all — Cursor has no harvester yet, and its numbers still only
exist as notes from an earlier scouting trip. It doesn't run on its own: nothing in the
desktop app asks for a harvest yet; the app's helper process opens the logbook and stops
there. Wiring that up comes later. And it never prices anything — tokens only; the cost
calculation belongs to a different part of the workshop.

## Honest parts

- The harvester trusts the diary's format completely. If OMP rewrites its diary format,
  the harvester won't complain — it will just start finding nothing, silently. There are
  tests that pin today's format, but no alarm bell for tomorrow's.
- It's quiet about failures. Missing folder, half-written line, a file that vanished
  mid-read — all handled by moving on, none by saying anything. If a harvest comes back
  empty on a machine that should have data, nothing explains why.
- It only knows its own machine's folder, chosen by convention, with no setting to change
  it — fine unless OMP moves its diaries.
- Everything is verified against synthetic diaries built from one redacted sample line.
  The real world has more variety than one sample; that gap is unmeasured.
