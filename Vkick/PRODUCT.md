# Product

## Register

product

## Users

Football fans in Iran distributing through Telegram who follow European football — the big five leagues plus anything else ESPN's API covers. They use the app during live match windows on low-end Android webviews and on desktop. Job to be done: know what their five clubs and five followed leagues are doing right now, make light per-match predictions that count toward a season-long leaderboard, and pass verdict on the players who mattered most. They open the app because a match is on, not to manage a roster.

## Product Purpose

A Telegram Mini App football companion (Vkick): follow a favorite club plus up to four more and up to five leagues from anywhere ESPN covers, predict lineups/subs/shots/standout players/head-to-heads before and during each match, climb season-long prediction leaderboards, and rate the players who mattered most with the crowd's "eye test". No fantasy machinery, no budgets, no squads. Success is a habit loop across the week's matchday slots where watching, predicting and rating reinforce each other — the live view makes the match itself the product, the leaderboard gives every pick season-long stakes, and the 3-card rating system keeps the crowd's verdict alive without distorting competitive scoring.

## Brand Personality

Three words: **floodlit, razor, alive.**

Voice: precise and terse, a broadcast touch without sportscaster hype. Numbers are treated with respect (tabular, amber-rated). The pitch is a character, not furniture: deep green-black under floodlights.

Emotional goals: the rush of a live goal, the pride of recognition from the crowd, and the calm competence of a well-set dashboard.

## Anti-references

- **Generic dark SaaS dark mode**: boring charcoal background + a single accent, no identity or atmosphere. Flat, wordy, generic admin feel.
- **Sofascore / WhoScored gray**: sterile stat-sheet sports pages with zero atmosphere; data without drama.
- **FPL / clunky fantasy UIs**: overwhelming card-stacked dashboards, noisy stat overload, admin-ritual heaviness.
- **Gamer neon overload**: excessive glows, gradients, animated-everything, rainbow accents. Energy must be earned, not sprayed.

## Design Principles

1. **The live moment owns the screen.** Whatever is happening on the pitch right now is the hero; everything else recedes.
2. **One meaning per color.** Teal means broadcast/action, amber means evaluation, red means danger, turf green means pitch. Never mix on one element.
3. **Earned spectacle.** Animation and glow are reserved for goal moments and live state; the resting UI is calm and confident.
4. **Personage without rainbow.** Club identity arrives through their own color and a real sense of place, not through decorative accents.
5. **Tactical depth as product.** The 2.5D pitch view is not a graphic, it is the living match: formations, momentum, and pressure made legible.

## Accessibility & Inclusion

- WCAG AA contrast on all text tokens (body >= 4.5:1, large >= 3:1).
- Full `prefers-reduced-motion` collapse; every animation has a static or crossfade fallback.
- Complete Persian (Vazirmatn) + English support with correct RTL/LTR handling and `dir` flipping.
- Tabular numerals everywhere numbers change (scores, countdowns, momentum values).
- Touch targets >= 44px; all pitch interactions usable without hover.