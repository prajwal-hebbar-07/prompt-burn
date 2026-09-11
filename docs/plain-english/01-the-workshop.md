# The workshop

**Twin of:** [Repo scaffold and workspace tooling](../architecture/01-repo-scaffold.md)

When work began, this project was a workshop before any machinery had been delivered: the bench
built, the power wired, the safety rules pinned to the wall, the floor marked out for where each
station would stand. That has changed completely. All seven stations have arrived and taken their
places on the floor. The room itself is what this document covers — the shared rules every station
must obey, the master switches that inspect and test them all, the automated inspection line, the
packaging conveyor, and the stamp that keeps every product labeled with the exact same version
number.

## What is actually on the bench

The project is a local dashboard that shows how much token usage you burn through with your AI
assistants and what that usage would cost if you were paying per token. The five processing stations
and two finished storefronts each have their own chapters in the guidebook (numbers 04 through 10).
This document covers the workshop itself:

- A master ledger naming the project and declaring it private (it will never be published as a
  reusable package for others to install).
- A stamped number on the master ledger stating the current version of the finished goods.
- A file locking down the exact version of the package-handling machinery everyone must use, so two
  workers on the project cannot quietly use different versions of the equipment.
- Two files agreeing on the minimum version of the engine the whole shop runs on, acting as twin
  witnesses to the rule.
- A rulebook of shared settings for how strictly work is checked, which version of the language is
  permitted, and strict warnings against careless lookups.
- A denial list of things never saved into the workshop archives — sawdust, scratch pads, secret
  keys, internal notes, and the metal shavings and temporary bundles generated during builds.
- A short notice at the front door explaining what the shop makes and pointing to the blueprint.
- A comprehensive parts ledger locking down the exact versions of every component, test runner,
  and styling tool used across all seven stations.
- An automated inspection line that runs the checking and testing switches whenever new work arrives
  at the door.
- A shipping conveyor that packages the finished goods for every major computer platform and the
  editor without anyone building files on a personal laptop.
- A specialized stamping tool that keeps the version number identical across all five places it is
  written, along with its own testing routine.
- A quiet corner holding the notes and sample files from the earliest scouting mission.

## All the marked-out floor spaces are full

The floor was originally marked out for two families of work areas: one for the internal processing
and handling stations, and one for the customer-facing counters. All seven marks are now occupied:

- Five processing stations handle the internal work: one defines the core rules and cost math, one
  manages the storage cabinet on disk, one harvests usage records from assistant transcripts, one
  coordinates the harvesting and storage into clean reports, and one crafts the visual panels and
  buttons.
- Two customer-facing stations deliver the dashboard: a standalone window on the computer desktop,
  and a built-in panel inside the code editor.

Each station has its own copy of the shared rulebook and its own testing routine. The rule from the
original plan held true: each work area was built only when its first real piece of work arrived.

## The rules the machines obey

Every machine on the floor inherits the same rules automatically from the master rulebook:

- **The checking is strict.** The rules catch mistakes early — such as looking up an item that
  might not exist — rather than letting a machine jam during operation.
- **The workshop is wired for how the engine actually behaves in practice.** The pieces connect
  according to the engine's real runtime habits, not a theoretical ideal.
- **Nothing is baked into finished goods by the checker alone.** The checker inspects quality;
  specialized bundlers and packaging tools assemble the final products.
- **The master rulebook at the front door checks zero files directly.** That is a deliberate
  formality; each station enforces the rules on its own files, but all start from the same page.

## The switchboard: how everything gets turned on

The switches mounted on the wall govern the entire floor:

- The daily running switch: turns on the desktop machine for day-to-day work.
- The checking switch: walks through the workshop, starting with the door formality and then
  inspecting every station on the floor.
- The testing switch: first runs the workshop's own helper tests (verifying the version-stamping
  tool), then walks every station running its full testing routine.
- The version-stamping lever: stamps a new version number across all five release papers
  simultaneously, or checks that all five agree.

The testing walk still steps past any station lacking a testing routine without raising an alarm.
That politeness means an empty bench never jams the switchboard, but it also means a station built
without tests would be quietly ignored. Every station on the floor today provides tests, but the
rule remains a house convention rather than an iron clamp.

## The automated inspection line and the shipping conveyor

Two major pieces of automated machinery now handle quality and delivery:

- **The continuous inspection line:** Lives outside any single worker's laptop. Whenever someone
  proposes a change or merges work into the main line, this line starts from scratch, installs the
  approved parts, and runs both the checking switch and the testing switch.
- **The shipping conveyor:** Cuts a new release on demand. It checks the entire workshop,
  calculates the next version number, builds the standalone desktop application for three major
  operating systems in parallel, packages the editor extension, and only if every single build
  succeeds without error, commits the version stamp, tags history, and places all finished downloads
  on the public counter. If a single build fails, nothing is stamped or released.

## What the reconnaissance left behind

The sample records from early scouting missions (examining assistant transcripts) remain safely
stored as reference materials. The small helper script that fetched them still sits in its corner,
ready to be swept out whenever no longer needed.

## What is still not true — said plainly

The honest ledger:

- **The top-level check inspects zero files directly.** All real checking happens inside the work
  stations. A stray file outside the stations would escape inspection.
- **The testing switch still skips any area lacking a test routine instead of complaining.** All
  seven areas comply today, but an omission would be silent.
- **There is still no automated broom or tidy tool.** Layout and formatting rules are not enforced
  by an automatic tool; they depend on human review.
- **The version check is not hooked to the daily inspection line.** The shipping conveyor verifies
  version alignment before building, but daily checks do not; a manual edit that causes the five
  papers to drift could sit unnoticed until release time.
- **The desktop machine requires a second, heavy metalworking toolkit to build its outer casing.** A
  standard setup can run all tests, but cannot build the final desktop executable without that
  separate native equipment.
- **The reconnaissance script still writes raw, unredacted records if pointed at a live folder.**
  There is one ignored folder set aside for testing; use that one, or nothing.
- **The floor markings are trusting:** Empty folders or folders placed outside the two marked
  families are silently ignored.

## How this bench grows

The workshop can continue to evolve cleanly: adding another station if a third entrance is ever
planned (which requires only its own folder, manifest, and rules without changing the room layout),
running the version-stamping tool and shipping conveyor to send out updates, adding an automated
broom when the team decides on formatting standards, and eventually sweeping away the reconnaissance
script now that the real stations do all the gathering.

The room is no longer an empty frame. The rules held firm through every delivery, and every station
bolted straight on.
