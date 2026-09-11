# The showroom

**Twin of:** [UI components (packages/ui)](../architecture/08-ui-components.md)

The showroom is where all the numbers gathered from your tools are brought out from the back
office, polished, and arranged on clean counters for you to inspect. It does not go outside, it
does not dig through files, and it does not connect to any servers. It simply receives a fresh
summary sheet from the desk in the back, lays out the display boards under clear lighting, and
lets you look around, flip calendar pages, or adjust settings on the configuration desk.

## The main scoreboard and display cases

When you step into the showroom, the first thing you see is the big overhead scoreboard. It shows
your estimated total spend for the selected time window. Right below it sits a colorful segmented
bar showing which tools burned the tokens—teal for one tool, terracotta for another, violet for
the third—paired with clear text so you never have to guess what a color means.

The display follows strict honesty rules:
- An unpriced model never shows up as zero dollars. A missing price gets an em dash, because
  showing zero would falsely suggest the work was completely free.
- When only some of your models have known prices, the grand total doesn't vanish into a blank
  dash. Instead, it adds up what it does know, marks the total with an approximation sign, and puts
  up a warning badge stating that the figure is a minimum floor.
- If one tool only reports usage across its whole monthly billing cycle while you are looking at
  today's work, its tally is kept out of today's total. It sits on its own row with a label
  explaining that it covers a wider cycle, so your daily budget is never distorted.

## The supplier clocks and meters

Right below the scoreboard sits a row of glass tiles showing the meters and countdown clocks
provided by your AI subscription services. These are not calculated by the showroom; they are the
direct words of each provider about what remains on your quota.

Each card shows the active account name (such as an email address), the name of the allowance
window (like a 5-hour burst window or a weekly pool), the percentage used, and the time the meter
resets. When usage crosses eighty percent, the meter turns amber and displays the words "near cap".
If a window has already expired before new numbers arrive, the old percentage is removed and
marked "window ended" so you are never misled by expired data.

## The three rooms

The showroom is divided into three distinct rooms that you can switch between using the top tabs:
- **The Dashboard:** The main hall holding the hero total, the provider quota meters, and a ranked
  leaderboard showing every model that burned tokens, with gold, silver, and bronze rank badges.
- **The Projects room:** A workshop view breaking down token consumption by working folders on
  your machine. At the top is a circular ring overview showing spend distribution, followed by
  visual horizontal model lanes and cards detailing inputs, outputs, and cache usage.
- **The Settings desk:** A counter where you can turn individual sources on or off, adjust folder
  locations, review bundled price sheets, and hand-enter rates for unfamiliar models.

## The honest parts

- **The showroom cannot save anything on its own.** When you adjust a toggle or type in a custom
  path on the settings desk, nothing is recorded until you press the save button. The showroom
  merely hands the new values to the back-office worker who writes them into the permanent filing
  cabinet.
- **The Enterprise key field is a display prop.** On the settings desk there is a field for an
  enterprise access key. You can type into it, but it is purely decorative today: it is not saved,
  not sent anywhere, and not recognized by the collectors.
- **Failures do not wipe the counter.** If an attempt to refresh numbers fails—say, the network
  dropped or a folder became inaccessible—the showroom does not panic and wipe your screen blank.
  The existing numbers stay on display, and an alert banner appears at the top explaining exactly
  which tool had trouble and which tool succeeded, complete with a Retry button.
- **Your visual preference stays in your pocket.** The switch between Auto, Light, and Dark mode is
  remembered directly in your viewing window's temporary pocket note. It is not saved in the
  central company filing cabinet, so a window on another screen can keep its own appearance.
