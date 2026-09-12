# The front door

**Twin of:** [Desktop shell (Tauri v2 + Node sidecar)](../architecture/07-desktop-shell.md)

The shop is now fully open for business. When you start the application, a clean window appears
on your screen — the shop's storefront. Inside, the chalkboard displays the running tally of
your AI spending, formatted neatly in dollars and cents. Behind the glass, invisible to the
customer, a dedicated back-office worker manages the filing cabinet, reviews recent receipts,
and tallies up the cost.

## The shop window and the front counter

The storefront is what you see and interact with. It contains the main board showing your total
burn, buttons to switch timeframes (such as today, this month, all time, or a custom calendar
range), and a button to request a fresh tally. It also holds a settings drawer where you can
turn individual assistants on or off, adjust where records are kept, or specify custom price
tags for unusual models.

Crucially, the front room does not rummage through your computer's files itself. It acts purely
as a gracious host:

- When the shop opens, it immediately asks the back office to gather the latest figures and
  display them.
- While the back office is tallying, the board keeps the last known numbers in place with a
  gentle spinning indicator. The display never blanks, never flickers to zero, and never hides
  what you were just looking at.
- If you switch the timeframe from this month to today, the front desk doesn't send the worker
  out to re-examine your computer. It simply asks the worker to re-add the receipts already
  filed in the cabinet for the new dates.
- If an assistant cannot be reached or a file is temporarily locked, the numbers stay on the
  board, and a notice appears across the top naming every assistant on the roster: the ones that
  ran into trouble and why, and — just as clearly — the ones that carried on fine. An assistant
  that is simply not installed or switched off is not named as trouble; only a real failure is.

## Slips through the counter

Between the front desk and the back office sits a narrow message slot. Whenever the front room
needs information, it writes a short request slip, drops it through the slot, and waits for a
reply slip to come back.

Every slip carries a ticket number so questions and answers never get mixed up. Because the
counter is strictly one-in, one-out, the front room and the back office stay in lockstep. The
front desk understands what the customer wants to see, and the back office understands how to
read files and do math, but neither one needs to know how the other does its job.

## The back-office worker and the filing cabinet

When the shop opens in the morning, the back-office worker unlocks the filing cabinet and
counts the drawers to make sure everything is in working order. The worker then calls out
through the doorway to confirm that the office is ready.

When a request slip arrives to gather fresh data:
1. The worker steps out to check each assistant's logbook across your computer. There are now
   several assistants on the roster, and one misbehaving logbook never stops the rounds: the
   worker collects from the ones that cooperate and reports the holdout in the notice.
2. Any new entries written since the last visit are copied into the central filing cabinet.
3. The worker consults the price catalog, calculates the total cost for the requested period,
   and writes the summary onto a response slip.
4. The slip is passed back through the counter to update the chalkboard.

If you add a custom price for a new model, the worker files the new rate and immediately
recalculates the total for your current view using the receipts already in the drawers. No
outside services are called, and no logbooks need to be re-read.

## Closing up at the end of the day

The back-office worker's shift is tied directly to the front door being open. The worker
watches the doorway continuously.

The moment you close the shop window — whether normally by quitting the application or
unexpectedly if the window shuts down — the worker sees the doorway close, immediately locks
the filing cabinet, packs up, and leaves. There is no separate cleanup routine, no stray
assistant left lingering in the background, and no chance of the filing cabinet being left
unlocked overnight.

## What the worker needs to exist

The application does not carry its own private worker inside its package; it relies on finding
a capable helper engine already installed on your computer.

Before opening the doors, the shop searches through all the standard places, toolkits, and
version managers on your machine to find a suitable worker (specifically, one modern enough to
handle the cabinet's database). If no suitable helper is found, or if the only one available is
too old, the front window opens with a clear, helpful notice explaining how to install the
required program, rather than crashing or vanishing without an explanation.

## The honest parts

- **The worker still requires an engine installed on your machine.** Until the app is packaged
  with its own embedded helper, your computer must have the required runtime installed. If it
  is missing, the window opens but displays an instructional error banner instead of your
  dashboard.
- **Requests move through the counter one at a time.** The counter handles slips in sequence.
  While everyday queries are virtually instantaneous, a long-running check to an external
  service will hold up subsequent inquiries until it finishes.
- **The automated tests run without opening the real shop.** The automated checks verify the
  entire back-office operation by creating a temporary practice room with dummy files, proving
  that the worker can read logs, calculate totals, handle damaged folders, and close up cleanly
  without ever touching your real records. One practice check — the roll call of which
  assistants are reachable at startup — has not been updated for the newest member of the
  roster and currently reports a mismatch until it is.
- **The storefront never wipes your screen on a bad tally.** Even if every assistant fails
  simultaneously, the shop preserves your existing data on screen and explains what
  failed, ensuring you never lose sight of your history.
