# The workshop

**Twin of:** [Repo scaffold and workspace tooling](../architecture/01-repo-scaffold.md)

Imagine a workshop before any of the machines have been delivered. The bench is
built, the power is wired, the safety rules are pinned to the wall, and the floor
is marked out for where each machine will stand. Nothing makes anything yet — but
everything that arrives next will bolt straight on, because the room was prepared
for it. That is where this project stands today.

## What is actually on the bench

The project is going to be a small dashboard that shows how much token usage you
burn through with your AI assistants (the ones named OMP and Cursor) and what that
usage would cost if you were paying per token. Right now, none of that dashboard
exists. What exists is the prepared room:

- A file that names the project and declares it private (it will never be
  published as a software package for others to install).
- A file that pins the exact version of the package-handling tool everyone must
  use, so two people on the project cannot quietly use different versions of the
  same machinery.
- A file that says "Node version 24 or newer" — Node being the engine the whole
  thing will run on — and a second file that repeats the same number, so there are
  two witnesses to the rule.
- A rulebook of shared settings for how every future piece of the project must
  behave: how strictly the work is checked, which version of the JavaScript
  language it may use, and a rule that the checking is extra-picky about things
  like whether looking something up in a list could come back empty.
- A list of things that must never be saved into the project's history — the
  equivalent of "no sawdust, no unlabelled keys, no envelopes with account
  numbers on the bench."
- A short front-page note explaining what the project is and pointing at three
  planning documents: what we are building, how we are building it, and the
  contract that keeps the two honest.

## The marked-out floor spaces

The room is marked out for two families of work areas. One family will hold the
thinking parts — the pieces that understand usage records, store them, and work
out costs. The other will hold the things you actually look at and interact with —
the dashboard itself and a panel inside your editor.

Here is the honest part: **neither floor space has anything standing on it yet.**
The directories for these work areas do not exist. That is deliberate. The
implementation plan says, in its own words, do not build empty shells; add a work
area only when its first real piece of work arrives. An empty box on the bench is
just clutter that someone has to dust around.

## The rules the future machines must obey

Because the shared rulebook exists before any machine does, every machine that
arrives will inherit the same rules automatically. A few of those rules, in plain
words:

- **The checking is strict.** The rulebook is set to the pickiest settings. When
  the code arrives, the checker will flag things like "this list might be empty"
  rather than letting the program crash later.
- **The room is set up for the engine it will actually run on.** The way pieces
  will be wired together matches how the Node engine really behaves, not some
  theoretical ideal.
- **Nothing gets baked into finished files by the checker itself.** The checking
  exists to catch mistakes, not to produce the final product; a separate step will
  do that when it exists.

There is one quirk worth knowing: the master rulebook lives at the top of the
project, and right now it is told to check *nothing at all* — because there is
nothing to check. Once the first real work area arrives with its own copy of the
rulebook, checking will happen there, per work area.

## What the spike left behind

Before all this, someone did some reconnaissance: they pulled real usage records
from OMP and Cursor and wrote down exactly what those records look like. That
investigation left three things — sample records saved as files, a short findings
note, and a small throwaway script that produced them. The plan treats those
samples as blocking: the first real code must be written to match the samples, not
to a guess.

## What is not yet true — said plainly

This section is the honest ledger:

- **Nothing is checked yet.** Because no work areas exist, the project's rulebook
  currently inspects zero files. If someone quietly weakened a safety rule in the
  shared settings today, no tool would complain — only a human reading the change
  would catch it.
- **The planned test and check commands do not exist.** The implementation plan
  schedules two commands — a test command and a type-checking command — as one of
  its very first commits, but they have not been written yet. Until they land, the
  plan's promise that "every commit should check cleanly" runs on trust.
- **There is no automatic formatting, no linting, no continuous-integration
  server.** Every style and quality decision is currently made by whoever writes
  the change and whoever reviews it.
- **The throwaway script has a sharp edge.** If you run it and give it a folder to
  write into, it writes the *raw, unredacted* records it fetched — including real
  usage data. The plan's samples are redacted, but re-running the script carelessly
  could put live numbers into a folder that gets saved into history. There is one
  ignored folder set aside for exactly this; use that one, or nothing.
- **The floor markings are trusting.** A work area folder with nothing inside it
  is invisible to the machinery, and a work area built outside the two marked
  families would be silently left out. Nothing validates this yet.

## How this bench grows

The next moves are already sketched: add the first real work area (which needs no
changes to the room itself — the floor markings already cover it), then add the
planned test and check commands so the rulebook starts enforcing itself. After
that, the throwaway script can be retired once its samples are safely recorded.

The bench is ready. The machines have not arrived. When they do, they will find
the rules waiting.