# The workbench

**Twin of:** [VS Code extension (apps/vscode)](../architecture/10-vscode-extension.md)

When you are working at your craft bench — writing code, editing files, running commands — you do
not want to stand up and walk over to the shop's front door just to check the electricity meter.
You want a small side counter built right into the bench itself, right beside the blueprints you
are actively working on.

This extension is that side counter.

## A tray in the workbench

Most add-ons in an editor cram themselves into the narrow side rail or tuck into a bottom drawer.
This tool does neither. When you open it through the command palette ("Prompt Burn: Open
Dashboard"), it slides out as a full-size panel right in the middle of your workbench, exactly
like a document or a drawing you opened for editing.

Because it sits in a standard workbench slot, you can treat it like any other page:
- You can pin it to the left or right, splitting your view so you can watch token burn while
  you work.
- You can slide it between different work areas or drag it across windows.
- When you close and reopen the editor tomorrow, the tray sits right where you left it.
- If you switch away to inspect a file, the counter does not clear its face or forget its numbers;
  it stays held in memory behind your papers, ready the instant you flip back to it.
- Asking to open it again simply taps the existing panel rather than stacking a second copy on
  your desk.

## Talking to the back office

The side counter has no filing cabinet of its own, and it never parses transcripts or logs by
itself. Behind the counter sits the exact same filing cabinet (`~/.prompt-burn/db.sqlite`) that
the standalone desktop app uses. Whichever tool you open first creates the cabinet and stocks the
initial price lists; the second tool simply opens the drawers that are already there.

When you flip open the counter, it picks up a private intercom to talk to the back-office reader.
The counter sends a numbered slip through the slot asking for the latest numbers; the reader checks
the cabinet, contacts the providers, calculates the estimated burn, and sends the slip back.
Every request carries its own ticket number so answers never get mixed up even if two requests are
called out back-to-back.

## The counter only moves when asked

The side counter never rings an alarm or blinks uninvited while you are trying to concentrate:
- It checks the books once when you first open the tray.
- After that, it stays completely quiet until you press the "Fetch data" button.
- Changing the viewing timeframe — from this month to today, or looking back across all time —
  does not call the outside world or scan any files. It only asks the back office to recount the
  slips already sitting in the cabinet.
- Adding a custom price rate files a new price slip in the cabinet and immediately recalculates
  your history, without needing to contact any AI provider.

If the outside connections fail or your internet drops, the counter never wipes its slate clean or
drops to zero dollars. It keeps the last verified total on display and raises a clear warning flag
across the top explaining which sources could not be reached.

## The honest parts

- **You have to install the cartridge by hand.** This tool is not listed in the public editor
  catalogue or marketplace. It is distributed as a packaged file (`.vsix`) attached to releases,
  and you install it directly into your editor.
- **The automated tests cannot test the real bench.** The automated checks verify the message
  protocol, the data reader, and the dials on an isolated test stand. Actually watching the tab
  slide into a live editor window, dock properly, and handle theme shifts is verified by hand in a
  test workbench.
- **It does not know when the front door made a sale.** If you run a data fetch in the standalone
  desktop app, the side counter does not automatically notice or refresh its display. It only
  learns about new entries when you tap "Fetch data" or reopen the tab.
- **The display controls are copied from the desktop shell.** The logic governing how numbers are
  held during a fetch and how error banners appear is duplicated between the desktop window and
  this editor tab. They share the same dials and styling, but their internal state machinery is
  duplicated rather than wired through a shared gearbox.
- **An unanswered slip stays in the tray.** If the back office were to crash mid-question without
  answering, the counter does not have an automatic timer to discard the waiting ticket.
