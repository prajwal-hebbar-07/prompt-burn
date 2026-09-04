# The workshop

**Twin of:** [Repo scaffold and workspace tooling](../architecture/01-repo-scaffold.md)

For a while this project was a workshop before any of the machines had been
delivered: the bench built, the power wired, the safety rules pinned to the
wall, the floor marked out for where each machine would stand. That has
changed. The machines have started arriving. The room is still what this
document is about — the rules every machine must obey and the switchboard that
turns them all on — but the floor is no longer empty.

## What is actually on the bench

The project is a small dashboard that shows how much token usage you burn
through with your AI assistants (the ones named OMP and Cursor) and what that
usage would cost if you were paying per token. Parts of that dashboard now
exist, but they live in their own chapters — the thinking parts, the storage,
the collectors, and the desktop app each get their own pair of documents
(numbers 04 through 07). This one covers the room itself:

- A file that names the project and declares it private (it will never be
  published as a software package for others to install).
- A file that pins the exact version of the package-handling tool everyone
  must use, so two people on the project cannot quietly use different versions
  of the same machinery.
- A file that says "Node version 24 or newer" — Node being the engine the
  whole thing will run on — and a second file that repeats the same number, so
  there are two witnesses to the rule.
- A rulebook of shared settings for how every piece of the project must
  behave: how strictly the work is checked, which version of the JavaScript
  language it may use, and a rule that the checking is extra-picky about
  things like whether looking something up in a list could come back empty.
- A list of things that must never be saved into the project's history — no
  sawdust, no unlabelled keys, no envelopes with account numbers on the bench,
  and now also the wood shavings and generated templates that the new desktop
  machine produces when it is built.
- A short front-page note explaining what the project is and pointing at the
  planning documents.
- A shopping list that has grown real: the record of exactly which versions of
  the checking tool, the test runner, and the desktop toolkit everyone is
  using. It used to be a page of blank paper; now it is a full ledger.

## The marked-out floor spaces are filling up

The floor was marked out for two families of work areas: one for the thinking
parts (understanding usage records, storing them, working out costs), one for
the things you actually look at and interact with. Three thinking work areas
now stand on their marks, and the desktop app stands on one of the interaction
marks. Each is a real working area with its own copy of the rulebook — and
each is described in its own chapter, not this one. Two interaction marks are
still empty: the dashboard-in-a-web-page and the panel inside the editor. The
rule from the plan still holds: a work area gets built only when its first
real piece of work arrives. No empty shells for dust to settle on.

## The rules the machines obey

Every machine on the floor inherits the same rules automatically, because the
shared rulebook predates them all. A few of those rules, in plain words:

- **The checking is strict.** The rulebook is set to the pickiest settings.
  The checker flags things like "this list might be empty" rather than letting
  the program crash later.
- **The room is set up for the engine it actually runs on.** The way pieces
  are wired together matches how the Node engine really behaves, not some
  theoretical ideal.
- **Nothing gets baked into finished files by the checker itself.** The
  checking exists to catch mistakes, not to produce the final product; the
  desktop app builds its finished form a different way.

And the quirk from before still holds, but it now matters less: the master
rulebook at the top of the project is still told to check _nothing directly_.
That is fine — it is a formality, a signature on the door — because every real
work area has its own copy of the rulebook and does its own checking. The
master rulebook just guarantees they all start from the same page.

## The switchboard: how everything gets turned on

Here is what actually changed since the room was empty. Two switches were
installed on the wall, and they are master switches:

- One switch checks everything. It first runs the formality check at the top
  of the room (which inspects nothing, as noted), then walks through every
  work area on the floor and runs that area's own checking.
- The other switch tests everything. It walks through every work area and runs
  that area's tests.

The walk is polite about it: if a work area has no test routine, the walk
simply steps past it without a complaint. That politeness is a double-edged
sword — it means the switches never jam on an area that has nothing to run,
but it also means a work area built without a testing routine would be quietly
skipped forever. Every area on the floor today has both routines, so the
switches currently reach everything. But nothing forces the next arrival to
follow suit; that is a house rule enforced by people, not by the machinery.

## What the reconnaissance left behind

Early on, someone did some reconnaissance: they pulled real usage records from
OMP and Cursor and wrote down exactly what those records look like. That
investigation left sample records saved as files, a short findings note, and a
small throwaway script that produced them. The samples did their job — the
first real code was written to match them — and the throwaway script is still
sitting in its corner, ready to be swept out.

## What is still not true — said plainly

The honest ledger, updated:

- **The top-level check inspects zero files.** All the real checking happens
  inside the work areas. A file that no work area has claimed would be checked
  by nothing.
- **A missing routine would be skipped, not flagged.** The master switches
  only reach work areas that have the matching routine. All four areas comply
  today; the fifth might not, and nothing would complain.
- **There is no automatic formatting, no linting, no continuous-integration
  server.** Every style and quality decision is still made by whoever writes
  the change and whoever reviews it. The master switches are shaped so a
  continuous-integration server could run them the day someone wants one — but
  nobody has wanted one yet.
- **The desktop machine needs a second toolkit.** Everything on the Node side
  installs itself with the usual package tool. The desktop app, though, has a
  half made of a different material entirely (the same material as many
  native apps), and that half needs its own installer and its own way of
  building. A new machine can run all the checks but cannot build the desktop
  app until that second toolkit is present. The "never save this" list
  already knows about the mess that build makes.
- **The throwaway script still has its sharp edge.** If you run it and give it
  a folder to write into, it writes the _raw, unredacted_ records it fetched —
  including real usage data. There is one ignored folder set aside for exactly
  this; use that one, or nothing.
- **The floor markings are still trusting.** A work area folder with nothing
  inside it is invisible to the machinery, and a work area built outside the
  two marked families would be silently left out — of the workspace and of
  both master switches. Nothing validates this yet.

## How this bench grows

The next moves are sketched: add the remaining interaction work areas (which
needs no changes to the room itself — the floor markings already cover them,
though each must bring its own checking and testing routines), decide on
automatic formatting and continuous integration (the switches are ready for
the latter), and sweep out the throwaway script now that its samples have done
their job.

The room is no longer empty. But the rules are holding: every machine that
arrived bolted straight on, and the next ones will too.
