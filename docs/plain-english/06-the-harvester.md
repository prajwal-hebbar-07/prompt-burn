# The harvester

**Twin of:** [OMP collector (packages/collectors)](../architecture/06-omp-collector.md)

Every conversation you have with OMP is written down as it happens — a running diary in a
folder on your machine, one line per entry, including separate diaries for the helper
sessions that get spawned alongside the main one. Each helper burns its own tokens, so a
harvester that only read the top of the folder would quietly undercount everything.

Claude Code — the assistant behind the Claude extension in your editor, and the same one you
get in a terminal — keeps diaries too, in its own folder, in its own dialect. So there are two
piles of local diaries to walk, and one harvester that knows both.

Beyond local diaries, other tools keep their tallies differently. Cursor doesn't write local
diaries at all; it keeps running token counts on its servers. And several providers maintain
fuel gauges — subscription clocks showing how much of your five-hour or weekly quota remains.
The harvester brings all these different harvests together in one pass.

## Walking the local diaries

When inspecting local conversation diaries, the harvester walks every subfolder. After each turn
where the assistant spoke, it reads four numbers off the page: fresh input, generated output, and
the two cache numbers. It notes which model did the talking, when it happened, which session it
belonged to, and which project folder that session was working in. That is all it takes. It is
not interested in anything else the diary mentions — not what anyone said, and not the tool's
own guess at the dollar cost.

The money is worked out later, from a separate price list, so that old entries can be re-priced
if prices change. Storing the tool's own estimate would fight that.

The two diary dialects differ in small ways. OMP writes the project folder once, on the diary's
first page, so the harvester has to read that page before it can file anything. Claude Code
repeats the project folder and the session name on every single page, which is friendlier: a
diary the harvester is resuming can be picked up in the middle without going back to the front.
Claude Code also spells its token labels differently, and writes model names with the release
date stuck on the end — like `claude-sonnet-4-5-20250929`. The harvester trims the date off so
the price list can find the model, and keeps the full name alongside it in case anyone asks.

One kind of page is skipped on purpose: the ones Claude Code writes itself when a turn was
interrupted or a network connection failed. They are marked as not coming from a real model;
nobody was billed for them, and there is nothing to price.

## How it avoids counting things twice

The harvester keeps a private notebook. For every diary it has read — either tool's — the
notebook records the last time the diary changed and how far into it the harvester read. One
notebook covers both piles: every entry is filed under the diary's full path, so the two can
never be confused for each other.

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

Each entry gets a name that comes out the same every time the same entry is read. The logbook
refuses to write two entries with the same name. So if a file is re-read by accident, or two
copies of it are found, the second attempt simply doesn't stick. The one exception is an
entry logged before project folders existed: re-reading its diary fills the folder in, and
nothing else about the entry is touched. A summary at the end
tells you how many files were read, how many were skipped as unchanged, and how many new
entries actually landed.

For OMP diaries the name is the session plus the entry's own id within that session. For Claude
Code it is the receipt numbers the model's answer came back with — and that choice matters,
because Claude Code copies old pages into a new diary whenever you resume or branch a
conversation. The copies get fresh page numbers but keep the original receipt numbers, so
naming by receipt is exactly what stops one answer being counted twice.

There are fallbacks in both dialects: a diary with no proper first page, or an entry with no
receipt numbers, gets named by its page number or by where it sits in the file instead. Weaker
guarantees, but still stable across re-reads, and they never collapse two different entries
into one.

## Harvesting remote tallies (Cursor)

Cursor does not write conversation diaries to your computer's drive. Instead, it tallies up your
token usage on its own web servers.

To harvest Cursor, the harvester visits Cursor's local storage file on your machine and borrows
your active sign-in ticket in memory. It then reaches out across the network to Cursor's service,
asking for your current billing cycle dates, your overall plan pool percentages, and the token
totals for every model you have used. It can also ask for the exact token totals within a
specific calendar window of days.

The harvester is careful with your credentials: your sign-in ticket is held in temporary memory
only for the seconds it takes to make the request. It is never written into Prompt Burn's
logbook, never saved to disk, and never printed in logs. Cursor's own dollar estimates are
ignored, just like OMP's; Prompt Burn always works out the cost itself from published token
rates.

## Reading the fuel gauges (Ollama, Antigravity, and OMP limits)

In addition to counting conversation tokens, the harvester checks your fuel gauges — how much of
your subscription allowance or rate limit is left before a provider cuts you off:

- **Ollama Cloud:** The harvester looks up the key stored when you signed into Ollama, reaches
  out to Ollama's usage service, and reads back your session and weekly fuel levels. Ollama
  does not publish the exact minute these windows reset, so the harvester shows what has been
  used without inventing a fake countdown timer.
- **Google Antigravity:** When using Antigravity, the harvester borrows your sign-in badge from
  your computer's secure keychain and asks Google's quota service how much capacity remains in
  your five-hour and weekly buckets. Google reports what is left, so the harvester flips the
  number to show how much you have burned. If your badge has expired, the harvester finds the
  necessary client credentials inside the helper program installed on your machine, contacts
  Google to get a fresh pass, and completes the check without interrupting your work.
- **OMP recorded limits:** OMP regularly asks providers about your remaining allowance while it
  runs and jots the answers into its own local database. The harvester reads the newest
  observations from that database (ignoring any older than a week) and groups them by account
  email so you can see your current standing at a glance.

## The grand harvest pass

When you open the app or click refresh, the master harvester sets everything in motion:

- **Everything runs together:** The network calls to Cursor, Ollama, and Google take time to
  travel across the internet, so the harvester launches them right away and inspects the local
  diaries while waiting for the replies. Everything finishes much faster than doing them one
  by one.
- **Resilience and partial success:** If you have no internet connection, if a tool isn't
  installed, or if your sign-in ticket expired, that tool's gauge or card simply reports that it
  is unavailable. The harvester never crashes, and one broken connection never stops the
  harvest from your other tools.
- **Clean toggles:** If you turn a tool off in Settings, the harvester skips it completely. It
  doesn't walk its folders, doesn't touch its credentials, and reports cleanly empty rather than
  showing an error.
- **Strict secret hygiene:** No passwords, access keys, or session tokens are ever saved in our
  records. They are used for a single request and dropped immediately.

## Two diaries, one subscription

Reasonable worry: if OMP and Claude Code both talk to Claude, are those tokens being counted
twice?

No. They are different diaries. A turn is written down by whichever tool you were using, never
by both, so the two piles never describe the same conversation. That is why the dashboard adds
the two subtotals together instead of trying to match entries between them — matching would
throw away real usage.

What they can share is the subscription paying for it. The Claude limit cards on the panel are
Anthropic's own count against your account, and Anthropic has already counted your Claude Code
turns in them. Those cards are never added to anything, never split per tool, and never turned
into money. Reading one as "OMP's share" is the mistake to avoid.

You can switch Claude Code off in Settings, and you can point the harvester at a different
folder if your diaries live somewhere unusual. Switching it off means off the screen too, not
just unharvested — the entries already in the logbook stay there and reappear the moment you
switch it back on. A switched-off source is not an error, and not a failure: the harvest simply
reports nothing for it and every other source keeps its numbers.

## What it doesn't do

It doesn't price anything — tokens and fuel percentages only; the cost calculation belongs to a
different part of the workshop. It doesn't run on an automatic timer either: a harvest happens
when the app asks for one, when you open it or press refresh. And it never keeps your passwords.

## Honest parts

- **The Claude Code half has never met a real diary.** Everything the harvester expects of
  Claude Code's pages was taken from the documented format, because there was no Claude Code
  data on the machine where it was written. If a label is wrong, the source will read as
  permanently empty rather than complain. The first machine with real Claude Code diaries
  should check it.
- **Undocumented service doors.** The usage checks for Ollama Cloud and Google Antigravity rely
  on private, unadvertised web endpoints that those tools use internally. If a provider changes
  or closes those doors, that fuel card will disappear quietly until the harvester is updated.
- **Cursor calendar boundary.** Cursor's servers refuse queries that reach across their
  historical system changes (August 2025 and May 2026), so the harvester cannot request
  all-time totals in a single query.
- **Keychain reliance.** Reading Antigravity's sign-in badge depends on your computer's built-in
  credential manager (such as the macOS keychain). On systems without one, it cleanly reports
  that no session was found.
- If receipt numbers ever stop being written in Claude Code diaries, the harvester falls back to
  line numbers — and line numbers change when a conversation is branched, so the same answer
  could land twice. Nothing would flag it; it would just look like extra usage.
- The harvester trusts all diary formats completely. If any tool rewrites its format, the
  harvester won't complain — it will just start finding nothing, silently. There are tests that
  pin today's formats, but no alarm bell for tomorrow's.
- It is quiet about failures. Missing folders, half-written lines, a vanished file — all
  handled by moving on, none by saying anything. If a harvest comes back empty on a machine
  that should have data, nothing explains why.
