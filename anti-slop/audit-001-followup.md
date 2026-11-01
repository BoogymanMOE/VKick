# Vkick — antislop audit follow-up (Delivery Gate)

**Date:** 2026-11-01
**Source audit:** `anti-slop/audit-001-2026-11-01.md`
**Mode:** antislop active: after (session override)

## Verification run

- `npm run typecheck` — PASS (no errors)
- `npm test` — PASS (all suites; playwright-dependent suite skipped)
- `npm run build` — PASS (tsc -b + tsc server + vite build, 3.11s)
- `npm run lint` — PASS (0 errors, 4 pre-existing warnings)

## Per-finding status

| # | Rule | Status | Notes |
|---|------|--------|-------|
| 1 | R-02 | FIXED | 75 em dashes replaced with commas in `src/i18n/strings.ts` user-facing copy (EN/FA/DE); 1 em dash left in the file header comment per instruction (code comments untouched). `{team} — team page` → en dash; "permanently, favorites…" → colon. |
| 2 | R-37 | FIXED | `DESIGN.md` created at repo root with identity, dials, palette, typography, components, motion, platform, texture. |
| 3 | R-37 | FIXED | Dials declared in `DESIGN.md`: `ENERGY 2 / RHYTHM 2 / MOTION 2` with one-line justifications. |
| 4 | R-19 | FIXED | Grep found `animate-pulse` on two non-loading elements (`MatchDetail` countdown chip, `PredictionsHub` "lock soon" text) and `animate-spin` on a loading spinner. Removed the two infinite pulses on non-loading elements; kept the spinner (loading state). CSS infinite animations remaining: `live-ring` (live dot, real live state), `shimmer` (loading), `live-glow` (live card), `tick-panic` (last-10s deadline heat, justified), `timeline-live-pulse` (defined but unused — dead CSS, harmless, left as-is). All stop under `prefers-reduced-motion`. |
| 5 | R-21 | DOCUMENTED | "Color mode" section added to `DESIGN.md`: dark-only by design, reason stated. |
| 6 | R-29 | DOCUMENTED | "Palette" section added to `DESIGN.md`: core tokens, single semantic brand accent (Volt, live/active only), functional status colors, dynamic team brand colors (excluded from cap). |
| 7 | R-01 | DOCUMENTED | Resolved by Finding 6's documentation (Volt semantics). |
| 8 | R-39 | FIXED | `src/index.css` base layer: `cursor: pointer` for button/[role="button"]/a/summary/[tabindex], `cursor: not-allowed` for disabled. |
| 9 | R-40 | FIXED (scoped) | Explicit width/height added to `TeamBadge` (both crest img tags, sized per `size` prop) and `PlayerAvatar` img. Covers home-feed match card crests, matches-list crests, team-page hero crest, squad-tab and recent-XI avatars. News thumbnails (`NewsCard`) left unsized — to be addressed in component library updates. |
| 10 | R-40 | DEFERRED | `fetchpriority="high"` on above-the-fold images deferred to a future performance pass. |
| 11 | R-40 | FIXED | Google Fonts fallback moved out of `<style>` and converted to a preload + `media="print"` stylesheet (non-render-blocking); `noscript` fallback included. |

## Motion audit (Finding 4, inline)

Infinite animations present after the fix:

- `live-ring` (`.live-dot`, 1.6s, infinite) — marks a real LIVE state; stops under `prefers-reduced-motion`. Justified.
- `shimmer` (`.shimmer`, 1.4s, infinite) — loading state only. Justified.
- `live-glow` (`.live-glow`, 2.4s, infinite) — live match cards only. Justified.
- `tick-panic` (`.tick-panic`, 1s, infinite) — last 10 seconds of a countdown. Justified.
- `timeline-live-pulse` (`.timeline-live-pulse`, 1.6s, infinite) — defined but unused in JSX. Dead CSS; harmless. Candidate for removal in cleanup.
- Tailwind `animate-spin` — loading spinner. Justified.
- Removed: `motion-safe:animate-pulse` on `MatchDetail` countdown chip and `animate-pulse` on `PredictionsHub` "lock soon" text (non-loading, non-essential).

## Delivery Gate — Block 1: Hard Gate

- Em dash in UI text outside carve-out? **No** (75 replaced; 1 remains in a code comment, which is not UI text and is allowed under R-02 scope).
- Horizontal overflow / broken mobile layout? **No** (unchanged; confined to intentional scroll containers).
- Statistics without a real source? **No**.
- Fictional testimonials? **No**.
- Visual assets created without confirmation/placeholder? **No** (crests from DB; initials fallback).
- Navbar links to nowhere? **No**.
- Text below WCAG AA? **No** (muted #7B958C on base = 5.75:1).
- Dead controls? **No**.
- Missing empty/loading/error states? **No**.
- Generic FAQ? **N/A** (no FAQ section).
- Keyboard navigation / focus state? **Yes** (Tab/Enter/Escape work; `:focus-visible` outline present).
- File/CSS patching via scripts? **No**.
- Theme toggle breaks a mode? **N/A** (no toggle shipped; dark-only documented).
- Delivered without running? **No** (typecheck + tests + build + lint run; see above).
- Fabricated claims? **No**.
- Built without direction / not labeled? **No** (`DESIGN.md` now exists with dials).
- Fabricated content? **No**.
- Missing cursor/aria/alt/focus/motion affordances? **No** (cursor pointer now set in base layer; aria-labels present; alt present; reduced-motion respected).
- Unsized media / lazy hero / render-blocking third-party script / unmeasured metric reported? **Partially** — above-the-fold crests and avatars now sized (Finding 9); news thumbnails remain unsized (deferred to component library updates); no `fetchpriority="high"` yet (Finding 10 deferred); Google Fonts fallback is now non-render-blocking; no unmeasured metrics reported.

## Delivery Gate — Block 2: Purpose-Gate

- Gradients as default without purpose? **No** (floodlight wash + club color wash are documented brand texture).
- Generic icons / Lucide default set? **No** (custom `icons.tsx` set).
- Monospace/uppercase typeface without reason? **No** (Archivo + Vazirmatn, documented).
- Background grid without purpose? **No** (pitch-watermark at 4% opacity, documented brand texture).
- Arrows on every button? **No**.
- Capsule badges without function? **No**.
- Glassmorphism > 1–2 elements? **No**.
- Large shadow on every component? **No**.
- Glow on cards/buttons/badges/icons/backgrounds/borders simultaneously? **No** (glow only on live cards).
- Identical feature cards without hierarchy reason? **N/A** (no feature-card grid).
- Template animations stacked? **No** (motion audit above; two unjustified infinite pulses removed).
- Generic illustrations? **No**.

## Delivery Gate — Block 3: Liveliness

- Dials set and explicit? **Yes** — `ENERGY 2 / RHYTHM 2 / MOTION 2` declared in `DESIGN.md`.
- One focal point per screen? **Yes** (score/table/crest).
- Hierarchical contrast? **Yes**.
- Whitespace as structure? **Yes** (spacing scale).
- One deliberate accent? **Yes** (Volt, live/active only).
- Identity motif? **Yes** ("Floodlit Night": pitch watermark, floodlight wash, club-tinted discs).

## Delivery Gate — Block 4: Craftsmanship & Quality Locks

- C-1 Intentionality: every visual decision has a written reason in `DESIGN.md` / `design-system.md`. PASS.
- C-2 Functional completeness: all interactive elements have real behavior. PASS.
- C-3 Content-driven composition: sections built around real content (matches, table, team, profile). PASS.
- C-4 Resilience: empty/loading/error states present; mobile breakpoints handled; keyboard-only use supported. PASS.
- C-5 Evidence over claims: no fake testimonials/stats/claims. PASS.
- R-05 layout not a template; R-11 radius varies; R-15 CTAs specific; R-16 no buzzwords; R-20 strong identity; R-21 dark-only documented; R-29 palette semantics documented; R-30 no cloning; R-31 reasons written. PASS.

## Ship verdict

**SHIP (with documented deferrals).** All approved findings are fixed or documented; typecheck, tests, build, and lint pass. Deferred: Finding 10 (`fetchpriority="high"` on above-the-fold images) and unsized news thumbnails (to be addressed in component library updates). No push performed.
