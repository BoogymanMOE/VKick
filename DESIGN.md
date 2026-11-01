# DESIGN.md — Vkick

## Identity

**Name:** Vkick (VerdiKick). **Concept:** "Floodlit Night" — a deep green-black pitch under stadium floodlights.

**Product:** Persian/English football scores & matchday app, shipped as a Telegram Mini App plus a web fallback. Audience: Iranian and international football fans, mobile-first (low-end Android webviews are a primary target).

**Personality:** broadcast energy, precise, data-dense but calm. Never generic "tech dark." Club identity is the crest, not a color wash.

**Direction routing:** For UI work, read this file for direction, then `antislop.md` as the filter.

## Dials

`Dial: ENERGY 2 / RHYTHM 2 / MOTION 2`

- **ENERGY 2 (Stripe/Vercel level):** the app says hello with a single focal point per screen (the score, the table, the club crest) and lets the data carry the weight. Justification: a scores app is opened dozens of times a day; shouting on every screen would fatigue the user.
- **RHYTHM 2 (consistent with a few breaks):** most sections share a card/grid rhythm, with deliberate breaks for the score hero, the pitch watermark, and the timeline rail. Justification: familiarity aids scanning live scores; breaks mark the moments that matter.
- **MOTION 2 (scroll-reveal + transitions):** subtle transitions only. No infinite loops on non-essential elements. Justification: low-end Android webviews must stay at 60fps; motion guides attention to state changes (goal, live), it does not decorate.

## Color mode

VKick is **dark-only by design**. The floodlit-night aesthetic matches the broadcast viewing context (matches are typically watched in the evening), reduces glare during live match sessions, and the Telegram mini-app surface is dark by convention. No light mode is planned. (R-21 satisfied: reason documented; R-34 N/A since no toggle is shipped.)

## Palette

### Core tokens (design-chosen)

- Base surfaces (dark-first): `--bg-base` #081613, `--bg-surface` #0E2520, `--bg-elevated` #122C25, `--border-subtle` #2A4D44.
- Text: `--text-primary` #EDF7F3, `--text-secondary` #93AEA6, `--text-muted` #7B958C (≥4.5:1 on every surface).

### Single semantic brand accent

- `--volt` #1FBFA0 (broadcast teal) is the **one** semantic brand accent and is used only for live/active states: primary actions, your predictions, CTAs, goal flashes, the selected date chip, active tabs. It is never a background wash.

### Other semantic status colors (functional, not decorative)

- `--live` #FF5A4D — LIVE state only (dot, pulse, live timeline).
- `--gold` #F2B705 — evaluative amber (crowd ratings, points, bonus).
- `--danger` #FF4D5E — errors, wrong predictions, red cards.
- `--pitch` #23A066 — turf green (positive chips, shot-plotter grid, tinted, never dominant).

These are **functional state colors**, not additional brand accents: each maps to a single meaning across the whole app and they are not counted toward R-29's accent cap, which governs decorative brand accents.

### Dynamic team brand colors (not counted toward the cap)

A team's `color` (from the DB) tints its own fallback badge, tactical discs, and stat bars. These are user-data-driven identity swatches, not design-chosen palette entries, so they are excluded from the R-29 cap.

### Rules

- Volt (teal) is never a background wash; it fills interactive elements and flashes.
- Points and ratings are always amber, even inside teal-branded contexts.
- A team's color tints only its own badge/discs/bars — never a decorative side stripe.
- Accent-on-dark tints (10–20%): `color-mix(in srgb, var(--volt) 15%, transparent)`.

## Typography

- **Display / numbers:** Archivo (800–900), tabular-nums, slightly negative letter-spacing in Latin only.
- **UI / body / Persian:** Vazirmatn (400, 700), full Persian + Latin support.
- Numbers always `font-variant-numeric: tabular-nums` — countdowns and live scores must not jitter.
- Persian text never gets letter-spacing (breaks joining).
- Scale: display 48px (scores), title 22px, body 16px, meta 14px, micro-label 12px.
- Micro-label is one `.label` class: 12px/700. Uppercase + 0.04em tracking in Latin; in Persian case/tracking flip off and size lifts to 12px (Vazirmatn reading floor).
- Minute badges ("57'"): Display font, 6px-radius chip, tabular.

## Component rules

- **Card:** 14px radius, 1px `--border-subtle`, `--bg-surface`, no heavy shadows (elevate via `--bg-elevated`).
- **Chip:** pill for status only; leading-edge accent bar marks tone (volt/gold/danger).
- **PlayerAvatar:** circular, initial fallback, never a photo dependency; explicit width/height.
- **LineupPitch:** turf plate with white markings; cells are the tappable grid; selected zone lifts 6% with a volt wash.
- **DateStrip:** 7-day scrollable strip, 2px fixture dots, calendar button pinned outside scroll.
- **Buttons:** volt fill + black text + pill (999px) for primary; ghost 1px border for secondary.
- **Club identity is the crest:** `TeamBadge` renders the bundled crest centred in a square footprint at 24/36/48/64px (64px is the club-page hero only); clubs with no crest fall back to their abbreviation on a club-coloured rounded tile in the same square.
- **Club color washes (never stripes):** the club-page hero fades the club's color out of one corner into `--bg-surface`; timeline event markers are club-tinted discs on the rail.
- **Icons:** one set in `src/components/icons.tsx`, 1.8 stroke on a 24 viewBox, `currentColor`. Glyph characters belong to toast text only. Abbreviations that are labels ("XI", "VS") stay text.
- **Touch targets:** ≥44px. Where the visual is smaller, the hit area is a 44px button around it.

## Motion rules

- Durations: `--t-fast` 150ms (hovers, toggles), `--t-std` 250ms (card entrances), `--t-slow` 450ms (celebrations).
- Easings: exits/standard `cubic-bezier(0.22, 1, 0.36, 1)`; playful overshoot `cubic-bezier(0.34, 1.56, 0.64, 1)`.
- Only transform + opacity animate (60fps). Respect `prefers-reduced-motion`.
- No infinite loops on non-essential elements. Permitted infinite animations mark a real state: live dot (live match), live card halo (live match), skeleton shimmer (loading). All stop under `prefers-reduced-motion`.
- Signature animations: goal flash, score odometer, timeline entrance (staggered 40ms), pin drop, live dot, rating snap, deadline heat, skeleton shimmer, live card halo, toast drop, pull ring.

## Platform note

- **Telegram Mini App:** respect `window.Telegram.WebApp` header color (set to `--bg-base`); haptic feedback on pin drop / rating (`HapticFeedback.impactOccurred('light')`).
- Must work in the Telegram WebView on iOS and Android: viewport constrained, no hover-only states (every control works via tap and keyboard).
- Safe areas + webview viewport quirks; test on low-end Android — keep animations GPU-cheap.
- Web fallback: same tokens, same components; only distribution differs.
- Share mode (`?embed=1` inside `/frame.html`): clean screenshots, no ad iframe.

## Texture

- Pitch motif: faint pitch-line watermark (center circle / grid lines at 4% opacity) behind prediction cards — brand texture, present but quiet.
- Shot Plotter reads as a pitch: turf plate under white markings, cells as the tappable grid, selected zone lifts 6% with a volt wash.
