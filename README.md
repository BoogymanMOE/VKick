# Vkick

A Telegram Mini App football companion: follow a favorite club plus up to four more and up to five leagues from anywhere ESPN covers, predict lineups/subs/shots/standout players/head-to-heads before and during each match, climb season-long prediction leaderboards, and rate the players who mattered most with the crowd's "eye test". Full concept: `concept.md`.

Competitions synced today: `eng.1`, `esp.1`, `ita.1`, `ger.1`, `fra.1`, `uefa.champions`, `uefa.europa`. The sync layer treats league slugs as config so any other ESPN-covered league can be added without code changes. Cups share ESPN's team-id space with domestic leagues, and a cup sync never overwrites a club's domestic `league`.

## Architecture

```
ESPN public API (unofficial, free)
        |
  [sync service]  normalizes →  SQLite (server/data/matchday.db)
        |                            |
  [Express API :8787]  ← vite dev proxy (/api)
        |
  [grammY bot]  goal alerts, /start, Mini App button
        |
  [React web app :5173]  ← the Mini App itself
```

**Zero-cost stack:** Node's built-in SQLite (`node:sqlite`) instead of a hosted Postgres, ESPN's unofficial API instead of a paid data provider, grammY long-polling instead of a webhook server. Nothing here needs a paid plan or a cloud account. The schema is written so a later move to Postgres is a translation exercise, not a redesign.

## Running it

```bash
npm install
npm run server      # API + sync loops + bot on :8787
npm run dev         # web app on :5173 (proxies /api to :8787)
# or both:
npm run dev:all
```

Copy `.env.example` to `.env` and set `TELEGRAM_BOT_TOKEN` (from @BotFather). While developing outside Telegram, keep `DEV_AUTH_SECRET` set and append `?devUser=<any-id>` to the web app URL to simulate a user.

Other scripts: `npm run build` (typecheck + bundle), `npm run typecheck`, `npm test`, `npm run preview`.

### Telegram Mini App setup
1. Run `start-telegram.bat` (or any HTTPS tunnel to :5173)
2. In @BotFather → /newapp (or Menu Button) → paste the https URL
3. Set `MINI_APP_URL` in `.env` to the same URL so the bot's /start button opens it

## Manual data tools (the ESPN-breaks fallback)

```bash
npm run sync                        # full sweep: scoreboards + live summaries + standings
npm run sync -- sync-match eng.1 401874934   # force one match
npm run sync -- sync-match eng.1 401874934 --dry-run  # print what would happen
npm run sync -- standings
npm run sync -- dev-token 12345     # print a dev auth token
```

If ESPN changes a response shape, the fix goes in `server/espn/normalize.ts` and nowhere else. Every sync pass logs parse failures loudly — that's your cue to check this file against a fresh payload.

## Where things live

| Path | What |
|---|---|
| `server/db/schema.ts` | All tables (mirrors `data-model.md` + `prediction-mechanics.md`) |
| `server/espn/normalize.ts` | The ONLY file that knows ESPN's JSON shapes |
| `server/sync/service.ts` | Cron loops: live 1m, scoreboards 10m, standings daily |
| `server/sync/upserts.ts` | Normalized data → SQLite, goal-alert detection |
| `server/scoring/statScore.ts` | Player stat score per `scoring-rules.md` |
| `server/index.ts` | All REST endpoints |
| `server/sync/teamStats.ts` | Team stats normalization + season leaderboard recompute |
| `server/bot/index.ts` | grammY bot + push queue drain |
| `server/notifications.ts` | Matchday pushes + the one place notification prefs are enforced |
| `src/lib/api.ts` | Frontend API client |

## API surface

Public (no auth): `GET /api/matches`, `GET /api/matches/:id`, `/lineups`, `/timeline`, `/players` (per-match stat table), `GET /api/teams` (+ `/:id` season line), `GET /api/leagues/:league/players?sort=goals|assists|…` (season leaderboard), `GET /api/leagues/:league/teams` (season team stats), `GET /api/standings/:league`

Auth (Bearer = Telegram initData): `POST /api/auth/login`, `GET /api/me`, `GET/POST/DELETE /api/me/favorites` (max 5 clubs, one flagged `is_favorite` — errors are machine-readable codes), `GET/POST /api/matches/:id/ratings` (1 vote per player per match, 1–10), `GET/POST /api/matches/:id/predictions` (lock enforcement per mechanic), `GET /api/me/predictions`, `GET /api/me/streak` (favorite-club streak + next threshold bonus)

Admin (`ADMIN_TELEGRAM_IDS`): `POST /api/admin/sync`, `POST /api/admin/notify`

## Real data everywhere

There is no demo data in the app. Every screen reads from the synced SQLite database:
fixtures and live scores from ESPN scoreboards, lineups/timelines/player stats from match summaries, team stats from box scores, and season leaderboards (`player_season_stats` / `team_season_stats`) recomputed server-side after each finished match syncs. When a competition hasn't started (or a stat isn't in ESPN's payload), screens show honest empty states — never seeded numbers.

## What's built vs. what's not

**Built end-to-end** (this list is the source of truth — older phase notes in `roadmap.md` are stale):

- All five prediction mechanics with per-mechanic lock windows, payload validation, and a server-side resolver that settles picks into the points ledger — lineup (2h pre-kickoff), sub board (lineup-drop → half-time lock, enforced by a real `halftime` match status), shot predictor (6-zone grid, kickoff lock), player to watch (stat gate + crowd gate + MVP bonus, 24h settle window), versus (user-chosen pair, stat-score duel)
- Points ledger + the three season leaderboards (global / per-league / per-club) with the first-to-reach tiebreak, and boards that render the unique `@username` identity with your own row highlighted
- Favorite-club streak tracking (3/5/10 thresholds, once per season) with the settle-then-read sweep
- The 3-card rating system (pick any 3 players, 1–10 + comment, cap enforced server-side) with aggregate crowd ratings shown beside the stat score, and a divergence-sorting eye-test page
- ESPN sync loops (live 1m, scoreboards 10m, fixture window 6h, standings daily, rosters + Understat weekly), goal alerts with per-club fan-out, and the manual CLI fallback (`npm run sync -- …`)
- Server-enforced push preferences (`user_notification_prefs`) — the Profile toggles actually gate the bot's sends, at queue time *and* at send time, per push kind
- Matchday notifications (`server/notifications.ts`): goal alerts, the lineup drop, the last call before kickoff, the half-time lock and the rating-window open — each claimed once per user/match/stage so the minute loop never repeats itself, and each mapped to its own Profile switch
- Localized bot pushes (`server/messages.ts`): copy is rendered per **recipient** from `users.language`, which each device reports via `POST /api/me/language`, so the bot speaks the same language as the app
- Pinned timeline comments: composer on the match Timeline tab (pin to an event or minute, 500 chars, optional https clip link), pins rendered under their event, comment counts surfaced, your own cards highlighted
- Guest/device accounts with full merge-on-upgrade, username-only login, Telegram initData auth, admin sync/notify endpoints

Removed: the curated `versus_pairs` admin path (endpoints + table, dropped by migration) — Versus Mode is the user-chosen pair in the prediction payload.

**No longer dormant — the server-only features have UI:**

- Per-user prediction history (`GET /api/me/predictions`) and the resolver's `breakdown` payloads now render as the "why did I get X" panel (`src/pages/Predictions.tsx`, reached from Profile), including the Shot Predictor's `zoneFromFallback` and `lenientSoT` leniency flags

**Not started:**

- Tapsell ads, referral mechanics (Phase 4)
- Full bracket tree for cups — round groupings exist (`matches.round` from ESPN notes, grouped on the Cups screen), but not a connected knockout tree
- League tables for a followed league outside the big five — the tabs (`LEAGUE_TABS`) and `syncStandings()` are big-five only
- Season boundary driven by the last tracked league finishing, rather than the calendar year, and a test for it

## Screens

- **Matches** (`#/matches`) — matchday list, live/upcoming/finished, your clubs first, "my teams only" filter
- **Match detail** (`#/match/:id`) — timeline, stats, lineups, ratings tabs
- **My Teams** (`#/my-teams`) — club picker (five slots, one anchored favorite) with a tab per catalog league plus cup-only clubs and national teams
- **Ratings** (`#/ratings`) — crowd ratings beside the stat score, the "eye test" view
- **Tables** (`#/table`) — league standings with your clubs highlighted
- **Cups / Browse / Player Stats / Team pages** — knockout fixtures grouped by round (first round → final) when ESPN labels them, league browsing, season stat leaderboards
- **Predictions** (`#/predictions`) — your pick history, each with the resolver's own scoring breakdown ("why did I get X")
- **Profile** (`#/profile`) — account, language (EN/FA with full RTL), notification and haptics settings

Tabs are URL-driven, so panels are deep-linkable — which is how the Telegram bot links into the app.

## Run it on your PC

### Windows: double-click `start.bat`

It checks Node, installs dependencies on first run, starts the dev server and opens your browser
once the server is actually ready. `Ctrl+C` in that window stops it.

If something goes wrong, run it in check-only mode:

```
start.bat --dry-run
```

That verifies Node, npm and dependencies and prints what it found, without starting anything.

### Any platform: npm

```bash
npm install
npm run dev          # http://localhost:5173
```

Use Chrome's device toolbar at ~390px wide — that's the most representative view for a Mini App.
The `LanguageToggle` in the header flips the whole app between English/LTR and Persian/RTL.

### Inside Telegram: double-click `start-telegram.bat`

Telegram only loads Mini Apps over HTTPS, so `localhost` can't be registered directly. This script
starts the dev server, opens a public HTTPS tunnel (using `cloudflared` if installed, otherwise the
`npx` build), and prints the BotFather steps. Copy the printed `https://…` URL into BotFather via
`/newapp`.

Telegram's SDK script is already loaded in `index.html`, so the same build detects the client at
runtime: the Telegram header/background are painted from `--bg-base`, vertical swipe-to-close is
disabled, and light haptics fire on tab switches, prediction lock and rating. In a normal browser every
one of those helpers is a silent no-op (`src/lib/telegram.ts`).

When you deploy, point the bot's menu button at your production static host instead — it's the same
build either way, only distribution differs.

## Animations

The signature animations from `design-system.md` are implemented:

| # | Animation | Where |
|---|---|---|
| 1 | Goal flash + 1.2s confetti (canvas) | match cards, match header, Shot Plotter zones |
| 2 | Score odometer | every score in match cards |
| 3 | Timeline entrance, 40ms stagger + cyan live edge | timeline |
| 4 | Pin drop with overshoot + ripple ring | Shot Plotter |
| 5 | Live dot, 1.6s double-ring pulse | live chips everywhere |
| 6 | Rating snap with integer pulse | rating sheet |
| 7 | Deadline heat (danger under an hour, per-second pulse in the last ten) | matches, match header |
| 8 | Skeleton shimmer | list screens and panels |

Plus sheet slide-up, toast slide-down, panel reveal and the backdrop fade. Every one is
transform/opacity only and collapses under `prefers-reduced-motion`.

## Notes for the next phase

- `src/types.ts` mirrors `data-model.md`, so API payloads type the components directly.
- The routing is `HashRouter` — it needs no server rewrite rule and behaves the same inside
  Telegram's webview and on static hosting.
- Animations follow the design system and all collapse under `prefers-reduced-motion`.
- Light mode is deliberately not built — dark-first per `design-system.md`.
