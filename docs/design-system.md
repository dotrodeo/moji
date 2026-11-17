# Moji design system — "Retro Internet Party"

**Status:** reconstructed from the code on 2026-11-17. The original design handoff that the code
cites ("design handoff README", "§sticker treatment") is lost, like the original design doc. The code
is the source of truth: tokens live in `packages/client/tailwind.config.ts`, the canvas in
`packages/client/src/index.css`, and the shared components in `packages/client/src/ui.tsx`. Where
this document and the code disagree, the code wins, and this file should be fixed.

Places where the code doesn't yet follow its own system are listed under [Known drift](#known-drift)
at the end. That list is the to-do for the tidy-up pass.

## Principles

1. **Stickers on a dark screen.** Interactive and celebratory elements look like die-cut stickers:
   a chunky dark outline, a flat neon fill, and a hard offset shadow with no blur. Structure
   (panels, inputs, dividers) stays quiet: thin hairlines on dark surfaces.
2. **Emoji are the content.** Clue emoji sit on light "paper" tiles so they read at a glance on any
   screen. Everything else steps back.
3. **Neon carries meaning.** Each accent has a job (see [Accents](#accents)). Pick the accent by
   meaning, not by what's free.
4. **Dark only.** `color-scheme: dark`. There is no light theme, and none is planned.
5. **Motion pops, never fades.** Things enter by scaling, never from `opacity: 0`, so content is
   always visible (to screenshots, to slow devices, mid-animation). Everything stops under
   `prefers-reduced-motion`.
6. **Phone first.** Most players arrive on a phone from a link in a group chat.

## Color

All colors are Tailwind tokens (`bg-pink`, `text-muted`, `border-hairline2`…). Don't use raw hex in
components.

### Surfaces and lines

| Token | Hex | Use |
|---|---|---|
| `ink` | `#100619` | The page canvas (`body`). |
| `screen` | `#15091f` | Unused. |
| `panel` | `#1a0d2c` | Cards and panels (`Panel`). |
| `panel2` | `#1d0f30` | Rows inside a panel (standings, lobby players). |
| `inset` | `#120720` | Recessed areas: inputs, the segmented-control track. |
| `outline` | `#160826` | The sticker outline and hard shadow, and the text color on every accent fill. |
| `hairline` | `#2c1a42` | Rare dividers. |
| `hairline2` | `#34204e` | The default border for panels, inputs and idle controls. |
| `hairline3` | `#2a1842` | Rare dividers. |

### Text

| Token | Hex | On `ink` | Use |
|---|---|---|---|
| `paper` | `#FFF1FA` | 18.1:1 | Primary text. Also the clue-tile fill. |
| `text-2` | `#D6C6EC` | 12.4:1 | Secondary emphasis. |
| `text-3` | `#C9B8E8` | — | Second place in standings. |
| `muted` | `#B79FD4` | 8.4:1 | Secondary text, labels, idle controls. The workhorse (54 uses). |
| `muted-2` | `#9d86bd` | — | Unused. |
| `muted-3` | `#8a72ab` | 4.8:1 | Tertiary text. The faintest shade allowed for words a player needs to read. |
| `muted-4` | `#7c64a0` | 3.9:1 | Placeholders and empty slots only. Below AA for body text. |
| `muted-5` | `#5a3c78` | 2.2:1 | Decoration only. Never for text. |

### Accents

Each accent has a role. Fills always take dark `text-outline` text, never `text-paper`: every
accent clears AA with outline ink (pink 5.9:1, the lowest; lime 15.6:1, the highest). On the dark
canvas, every accent also works as a text color (pink 6.1:1 and coral 6.3:1 are the lowest).

| Token | Hex | Role | Examples |
|---|---|---|---|
| `lime` | `#BFFB4B` | **Go / primary action / valid.** | The default `StickerButton`, guess-input focus, filled room-code slots, revealed hint letters. |
| `pink` | `#FF3DA5` | **You / selection / brand.** | The selected avatar, the active emoji category, the secondary (`outline`) button, the first wordmark tile, the lobby eyebrow. |
| `cyan` | `#29D6FF` | **Prompts and information.** | The secret-prompt eyebrow, the round chip, the info notice banner, links ("Copy link"), the selected pack, chat focus. |
| `gold` | `#FFD23F` | **Score and winning.** | Scores, the countdown, 1st place, the winner eyebrow, the selected segment, your standings row. |
| `mint` | `#36E5A0` | **Success.** | "Solved it!", ready players, positive score deltas, the live dot. |
| `coral` | `#FF5468` | **Error / danger.** | The error banner, clue-rule errors, a timer in its last seconds, "Time's up!", negative deltas. |
| `orange` | `#FFB02E` | **Warning / connection.** | The "Reconnecting…" bar, the 10-emoji cap. |

Each accent has a `-light` tint (`pink-light`, `cyan-light`, …) for hover text and third place.
`lime-light`, `gold-light` and `mint-light` are unused.

Soft tinted backgrounds use the accent at low opacity: `bg-gold/10` (your row), `bg-mint/10` (a ready
player), `bg-mint/20` and `bg-coral/20` (score-delta pills).

## Typography

| Family | Token | Use |
|---|---|---|
| Bricolage Grotesque | `font-display` | Headlines, buttons, sticker text, the wordmark. Always `font-extrabold`. |
| Space Grotesk | `font-sans` (default) | Body text, inputs, guesses, chat. |
| Space Mono | `font-mono` | Labels (eyebrows), numbers (scores, timers, room codes), segmented options. |

All three fall back to **Noto Color Emoji**, so emoji render the same on every platform. All are
loaded from Google Fonts in `index.html`.

**Scale in use:**

| Role | Classes |
|---|---|
| The secret prompt (the biggest type in the game) | `font-display text-5xl sm:text-7xl font-extrabold` |
| Hero and screen titles | `font-display text-3xl` to `text-4xl`, growing to `sm:text-5xl` (landing headline, reveal, winner) |
| Section / prompt | `font-display text-2xl sm:text-3xl` |
| Body | `text-base`; `text-sm` for secondary; `text-lg` for primary inputs |
| Eyebrow (label) | `Eyebrow`: `font-mono text-xs uppercase tracking-[2px] text-muted`, often recolored by role |
| Numbers | `font-mono`, usually `text-gold` for scores |

Inputs are at least 16px (`text-base`/`text-lg`) so iOS doesn't zoom on focus.

## Shape

### Radius

| Token | Value | Use |
|---|---|---|
| `rounded-sticker` | 16px | Sticker buttons, banners-as-stickers (the "solved" bar). |
| `rounded-tile` | 12px | Emoji tiles, avatars, wordmark letters, inputs, code slots. |
| `rounded-card` | 20px | Panels. |
| `rounded-pill` | 24px | Chips, segmented controls, pack pills, score-delta pills. |

### Borders

Three weights, each with one job:

| Weight | Where | Color |
|---|---|---|
| **2.5px** (the sticker outline) | Anything that is a sticker: buttons, tiles, avatars, chips, the selected segment | `border-outline` (or `border-pink` on the secondary button) |
| **2px** | Inputs and code slots | `border-hairline2`, turning to an accent on focus or when filled |
| **1px** | Structure: panels, rows, the segmented track | `border-hairline2` |

## Elevation: sticker shadows

Hard offset shadows in `outline` ink, no blur. Only stickers get them; panels are flat. The one
exception is the landing page's tilted sample-clue card, which is drawn as a big sticker.

| Token | Offset | Use |
|---|---|---|
| `shadow-sticker-sm` | 3px | Small stickers: avatars, chips, the selected segment, small tiles. |
| `shadow-sticker` | 4px | Buttons and clue tiles at rest. |
| `shadow-sticker-lg` | 5px | Something lifted: a tile being dragged in the clue tray, the tilted sample-clue card on the landing page. |
| `shadow-sticker-hover` | 6px | A button under the pointer. |
| `shadow-sticker-press` | 1px | A button being pressed. |

**Interaction:** hover lifts (`-translate-x-0.5 -translate-y-0.5` plus the hover shadow); press
sinks (`translate-x-0.5 translate-y-0.5` plus the press shadow), so the sticker appears to move
over its own shadow. Disabled is `opacity-50` with no pointer events.

The secondary (`outline`) button uses the same shadow in **pink** (4px, and 6px on hover). It isn't
a token yet (see drift).

## Motion

| Animation | Duration | Use |
|---|---|---|
| `animate-moji-pop` | 0.38s, springy | Every screen and panel entering. Scale 0.965 → 1.012 → 1. |
| `animate-moji-tilebob` | 0.32s | A tile landing in the clue tray. Scale and a slight rotate. |
| `animate-moji-float` | 2.6s loop | Idle hero emoji, the winner's crown. |
| `animate-moji-pulse` | 1s loop | Live indicators (the "next round" dot). |
| `animate-moji-count` | 0.8s | The 3-2-1-GO count. The only animation allowed to use opacity, because each number is meant to vanish. |
| `animate-moji-confetti` | 2s | Winner confetti. |

**Rules:**
- Entries scale; they never start at `opacity: 0`.
- `index.css` turns every animation and transition off under `prefers-reduced-motion: reduce`.
  Nothing may rely on an animation finishing to show content or to work.

## Canvas

`body` is `ink` with three soft radial glows: pink at top-left, cyan at top-right, lime at
bottom-right. Over them sits a faint 42px grid of 4%-white lines, fixed to the viewport. Screens
draw on this canvas directly; panels sit on top of it.

## Components (`packages/client/src/ui.tsx`)

| Component | What it is | API |
|---|---|---|
| `StickerButton` | The button. | `variant`: `lime` (default: primary, "go"), `outline` (secondary: transparent with a pink outline and shadow), `pink` / `cyan` / `gold` / `mint` (contextual, matching the accent roles). `size`: `sm`, `md`, `lg`. Plus all button attributes. |
| `Panel` | The card surface: `bg-panel`, 1px `hairline2`, `rounded-card`. | `pop` adds the entry animation. |
| `Eyebrow` | The small mono uppercase label above titles. | Recolor with a text class by role (e.g. `text-cyan` over a prompt). |
| `Segmented` | A pill segmented control. The selected option is a gold sticker. | `options`, `value`, `onChange`, `disabled`, `label` (the group's accessible name). Sets `aria-pressed`. |
| `Avatar` | The player's emoji on a colored sticker tile. The color is derived from the player id (pink, cyan, lime, gold, mint or orange), so a player keeps their color all game. | `emoji`, `id`, size via `className`. |
| `Wordmark` | The MOJI logo: four tilted letter tiles (M pink −3°, O cyan +2°, J lime −2°, I gold +3°). | `size`: `md`, `lg`. |
| `cn` | Joins class names, dropping falsy ones. | — |

### Patterns not yet extracted into components

These recur across screens with the same classes, and are part of the system:

- **Clue tile.** An emoji on `bg-paper`, `rounded-tile`, a 2.5px `border-outline`, and `shadow-sticker`
  (or `-sm` when small). Sizes are `h-14 w-14 text-3xl`, growing to `sm:h-20 sm:w-20 sm:text-5xl`
  for the clue being guessed. Used on Guess, Reveal, Create (the tray) and Landing.
- **Sticker chip.** A rotated (−2° to +2°) `rounded-pill` sticker with an accent fill and outline
  text, for moments like the round banner and the prompt reveal.
- **Input.** `bg-inset`, 2px `border-hairline2`, `rounded-tile`, at least 16px text. On focus the
  border turns to the context's accent (lime for guessing and search, cyan for solver chat, pink for
  your name).
- **Banner.** A full-width bar fixed to the top with dark `text-outline` text, colored by role:
  orange for connection status (`role="status"`), coral for errors (`role="alert"`, tap to dismiss,
  5 s), cyan for information (`role="status"`, tap to dismiss, 9 s).
- **Toggle chip.** For pack pills and the avatar picker: idle is `border-hairline2` with muted text;
  selected is a sticker in the role's accent, with `aria-pressed`.
- **Score numerals.** `font-mono text-gold`, with thousands separators.

## Layout

- **Mobile first.** Breakpoints are Tailwind's `sm` (640px) and `lg` (1024px). `lg` is where the
  Guess screen splits into columns.
- **Page container:** `mx-auto px-4`, with widths by screen type: `max-w-5xl` for game screens,
  `max-w-xl` for forms (Join), and `max-w-md` for centered interstitials ("Mojibot is warming up…",
  "open in another tab").
- The Guess screen fills the phone with `h-[100dvh]`, so the browser's own bars never push the input
  off-screen.

## Accessibility

- Text on an accent fill is always `text-outline`; every combination clears AA (5.9:1 or better).
- Words a player must read use `muted-3` or lighter. `muted-4` is for placeholders, `muted-5` for
  decoration.
- Toggles expose `aria-pressed`. Groups of toggles have an accessible name. Every input has a label
  or an `aria-label`.
- Banners use `role="status"`, or `role="alert"` for errors.
- Everything works with motion off.
- The letter-hint blanks carry an `aria-label` that reads out the answer so far.

## Known drift

Measured on 2026-11-17. This is the to-do list for the tidy-up pass. Each item is the code departing
from the system above, not the system being wrong.

1. **The sticker outline width isn't a token.** `border-[2.5px]` is written out 22 times. It should be
   one utility (for example `border-sticker`).
2. **The pink sticker shadow is hardcoded.** `shadow-[4px_4px_0_#FF3DA5]` and its 6px hover in the
   `outline` button variant should be tokens like the outline-ink shadows.
3. **Raw hex in components:** five occurrences (`#FF3DA5` ×2 from the item above, `#FF5468`,
   `#BFFB4B`, `#2c1a42`). Each has a token.
4. **Label styles vary.** Eyebrow-style labels use `tracking-[2px]` (13), `tracking-[1.5px]` (7) and
   `tracking-widest` (2), and mono labels come in `text-xs` and `text-[10px]` (4). Settle on two
   (the eyebrow, and a smaller caption) and make them tokens or components.
5. **Unused tokens:** `screen`, `muted-2`, `lime-light`, `gold-light`, `mint-light`. Remove them, or
   give them a job.
6. **Three near-identical hairlines** (`hairline` `#2c1a42`, `hairline2` `#34204e`, `hairline3`
   `#2a1842`), with 17 / 1 / 1 uses. `hairline2` is the real one. Fold the other two in, or document
   when each is used.
7. **Focus color varies by input** (lime, cyan, pink, by context). That's arguably intended (accent
   by role), but it isn't written down anywhere else. Confirm the rule or pick one.
8. **13 hand-styled `<button>` elements** outside `StickerButton`. Some are right as they are (emoji
   picker cells, tray tiles, text links); the rest should become `StickerButton` or a named
   pattern (toggle chip, text link).
9. **The recurring patterns above** (clue tile, sticker chip, input, banner, toggle chip) are
   repeated as class strings in several files. Extract the ones used three or more times into
   `ui.tsx`.
