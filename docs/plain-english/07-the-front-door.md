# The front door

**Twin of:** [Desktop shell (Tauri v2 + Node sidecar)](../architecture/07-desktop-shell.md)

The product now has a front door. Open it and you get one real window on your screen — the
shop's facade. Behind the window, invisible to anyone passing by, a back-office worker has
already unlocked the filing cabinet and is sitting there with it open, ready for business.

## The shop window is just glass

Right now the window shows nothing but a notice: shell only. It is a pane of glass with no
shelves behind it. No numbers, no chart, no estimated total — not because they are broken but
because nobody has built the counter that passes data through the glass yet. That counter, the
pipe between the window and the back office, is the very next thing on the plan.

## The back-office worker

When the shop opens (you start the app), the window hires a worker before it even shows itself.
The worker's one job at the moment: walk to the filing cabinet, open it, and confirm it's real —
not just "the cabinet exists" but "I opened it and counted actual drawers inside." Then the
worker calls out one line through the doorway: _ready, cabinet is here, it has five drawers in
it._ That call-out is how the shop knows the worker made it in; it is also how the automated
check verifies the whole arrangement without needing a shop at all.

The worker holds the key to the cabinet and keeps it in their pocket. When the shop closes —
the window shuts, whether normally or by crash — the worker sees the doorway close, locks the
cabinet, and leaves. There is no separate "please close up" routine and no manager who has to
remember to fire the worker: closing the door _is_ the signal. So the cabinet is never left
unlocked overnight by a forgotten worker.

## What the worker needs to exist

The worker is not part of the shop itself; the shop assumes there is a person on the machine
who can do the job. Concretely: your computer must have the Node program installed and findable
in the usual places, or the shop fails to open at all — with a message that says exactly that,
rather than silently opening an empty shell. On your own development machine that is nearly
always true. Someday the app will be packaged with its own worker so nobody needs to install
anything; today it does not, and the packaging is deliberately switched off until then.

## The honest parts

- **Nothing is sold through the window yet.** The glass is real, the worker is real, the
  cabinet is real — the counter between them is not built. The estimated total lands in the
  next few commits.
- **The worker runs from loose papers, not a bound ledger.** In this development stage the
  worker works directly from the handwritten source pages, with a small page-turning helper
  that fixes up the page references. That helper is a temporary trick and both it and the
  loose-paper arrangement are marked as things to throw away when the app is packaged.
- **The worker needs the Node program installed.** See above; without it the door doesn't open.
- **The automated check uses a throwaway home folder.** The test that proves the worker does
  the job — opens the cabinet, counts the drawers, locks up cleanly — points the worker at an
  empty dummy home folder first, so your real filing cabinet is never touched by a test. On
  Windows that trick does not work the same way; the check is written for mac and unix.
- **The check cannot see the window itself.** It proves the back office works without needing
  the shop's machinery (which is heavy and separate); the window's own behaviour is only
  observable by actually running the shop on a machine with the right tools installed.
