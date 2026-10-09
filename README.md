# Vkick

A Telegram Mini App football companion: follow a favorite club plus up to four more and up to five leagues from anywhere ESPN covers, predict lineups/subs/shots/standout players/head-to-heads before and during each match, climb season-long prediction leaderboards, and rate the players who mattered most with the crowd's "eye test". Full concept: `concept.md`.

Competitions synced today: **32** — the big five (`eng.1`, `esp.1`, `ita.1`, `ger.1`, `fra.1`), six more domestic leagues with real tables (`ned.1`, `por.1`, `tur.1`, `sco.1`, `gre.1`, `bel.1`), eleven club cups (the UEFA competitions plus the big five's domestic cups) and ten international tournaments. The sync layer treats league slugs as config (`server/espn/types.ts`) so any other ESPN-covered competition can be added without code changes. Cups share ESPN's team-id space with domestic leagues, and a cup sync never overwrites a club's domestic `league`.

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

Other scripts: `npm run build` (typecheck + bundle), `npm run typecheck`, `npm test`, `npm run lint`, `npm run format`, `npm run preview`.

CI (`.github/workflows/ci.yml`) runs typecheck, lint, the test suite and the build on every push and pull request, on the Node pinned in `.node-version` (the same one Render uses). Lint gates on errors only — `no-explicit-any` is configured as a warning, so a stray `any` is flagged without breaking the build.

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
npm run sync -- rosters             # refresh club squads (weekly lane, manual)
npm run sync -- understat           # refresh Understat xG/PPDA (big five, weekly)
npm run sync -- dev-token 12345     # print a dev auth token
```

If ESPN changes a response shape, the fix goes in `server/espn/normalize.ts` and nowhere else. Every sync pass logs parse failures loudly — that's your cue to check this file against a fresh payload.

## Demo data (dev only)

```bash
npm run seed:demo                        # 6 demo users, predictions, ratings, leaderboard rows
npm run seed:demo -- --reset             # wipe the demo cohort first, then re-seed
npm run seed:demo -- --users 10 --matches 20
```

`server/dev/seedDemoData.ts` writes through the real scoring path — points come from
`scoreLineup` and land in the ledger via `award()` — so the demo board can never disagree with
the real one. It attaches predictions to **synced** fixtures rather than inventing them (run
`npm run sync` first), and mints no credentials: demo accounts are reachable only through the
`?devUser=900001` dev-token path. `assertNotProduction()` refuses to run under
`NODE_ENV=production`, and `--reset` deletes nothing but the `9000NN` cohort.

## Where things live

| Path | What |
|---|---|
| `server/db/schema.ts` | All tables (mirrors `data-model.md` + `prediction-mechanics.md`) |
| `server/routes/*.ts` | Route modules mounted by `server/index.ts`: `auth` (login/guest/register + guest merge), `me` (profile, favorites, leagues, streak, prefs), `football` (matches, teams, squads, standings), `predictions`, `ratings` (+ comments), `leaderboards`, `admin` |
| `server/espn/normalize.ts` | The ONLY file that knows ESPN's JSON shapes |
| `server/sync/service.ts` | Cron loops: live 1m, scoreboards 10m, standings daily |
| `server/sync/upserts.ts` | Normalized data → SQLite, goal-alert detection |
| `server/scoring/statScore.ts` | Player stat score per `scoring-rules.md` |
| `server/index.ts` | App wiring: mounts the route modules, `/health`, static `dist/` + SPA fallback, sync/resolver/bot startup, retention sweep |
| `server/sync/teamStats.ts` | Team stats normalization + season leaderboard recompute |
| `server/bot/index.ts` | grammY bot + push queue drain |
| `server/notifications.ts` | Matchday pushes + the one place notification prefs are enforced |
| `src/lib/api.ts` | Frontend API client |
| `scripts/` | Asset tools (`fetch-logos`, `import-logos`, `logo-normalize`, `make-icons`, `ui-audit`, `wait-for-api`); retired one-off debug scripts live in `scripts/legacy/` |

## API surface

Ops: `GET /health` (liveness probe — 200 while the process and DB answer, 503 if the DB is broken; this is what `render.yaml`'s health check hits)

Public (no auth): `GET /api/matches` (relevance window by default — live now + last 3 days of results + next 14; accepts `league`, `date`, `from`/`to` for an explicit range, and `limit`), `GET /api/matches/:id`, `/lineups`, `/timeline`, `/commentary`, `/players` (per-match stat table), `GET /api/teams` (+ `/:id` season line, `/:id/players`), `GET /api/leagues/:league/players?sort=goals|assists|…` (season leaderboard), `GET /api/leagues/:league/teams` (season team stats), `GET /api/standings/:league`, `GET /api/competitions`

Auth (Bearer = Telegram initData, or an `mg_` session token from the username path): `POST /api/auth/login`, `GET /api/me`, `GET /api/teams/:id/understat` (xG/xPts/PPDA for one club), `GET/POST/DELETE /api/me/favorites` (max 5 clubs plus up to 5 national teams, one flagged `is_favorite` — errors are machine-readable codes), `GET/POST /api/me/leagues` (max 5), `GET/POST /api/me/referral` (+ `/redeem`), `GET/POST /api/matches/:id/ratings` (3-card cap, 1 vote per player per match, 1–10), `GET/POST /api/matches/:id/comments`, `GET/POST /api/matches/:id/predictions` (lock enforcement per mechanic), `GET /api/me/predictions`, `GET /api/me/streak` (favorite-club streak + next threshold bonus)

Public leaderboards: `GET /api/leaderboards/global`, `/league/:league`, `/club/:teamId`

Admin (`ADMIN_TELEGRAM_IDS`): `POST /api/admin/sync`, `POST /api/admin/sync-window`, `POST /api/admin/notify`

## Real data everywhere

There is no demo data in the app. Every screen reads from the synced SQLite database:
fixtures and live scores from ESPN scoreboards, lineups/timelines/player stats from match summaries, team stats from box scores, and season leaderboards (`player_season_stats` / `team_season_stats`) recomputed server-side after each finished match syncs. When a competition hasn't started (or a stat isn't in ESPN's payload), screens show honest empty states — never seeded numbers.

## What's built vs. what's not

**Built end-to-end** (this list is the source of truth — older phase notes in `roadmap.md` are stale):

- All five prediction mechanics with per-mechanic lock windows, payload validation, and a server-side resolver that settles picks into the points ledger — lineup (2h pre-kickoff), sub board (lineup-drop → half-time lock, enforced by a real `halftime` match status), shot predictor (6-zone grid, kickoff lock), player to watch (stat gate + crowd gate + MVP bonus, 24h settle window), versus (user-chosen pair, stat-score duel) — every mechanic but the Lineup Predictor only accepts writes once ESPN's official lineup is published (`LINEUP_NOT_PUBLISHED`), the same `home_formation` signal the lineup-drop push uses (with a documented fallback: both sides having a starter in `match_player_stats` counts as published, so competitions that never emit a formation aren't stranded). Each window is self-describing (`requires: "lineup"`), and scheduled matches within ~90 min of kickoff refresh on a tighter sync lane so the gate opens within minutes of the XI landing
- Points ledger + the three season leaderboards (global / per-league / per-club) with the first-to-reach tiebreak; boards render the unique `@username` identity, highlight your own row, and lead with your rank and points as a summary line (the below-page "you" row folds into it)
- Favorite-club streak tracking (3/5/10 thresholds, once per season) with the settle-then-read sweep
- The 3-card rating system (pick any 3 players, 1–10 + comment, cap enforced server-side) with aggregate crowd ratings shown beside the stat score, and a divergence-sorting eye-test page
- ESPN sync loops (live 1m, near-kickoff ~2.5m, scoreboards 10m, fixture window 6h, standings daily, rosters + Understat weekly), goal alerts with per-club fan-out, and the manual CLI fallback (`npm run sync -- …`)
- Server-enforced push preferences (`user_notification_prefs`) — the Profile toggles actually gate the bot's sends, at queue time *and* at send time, per push kind
- Matchday notifications (`server/notifications.ts`): goal alerts, the lineup drop, the last call before kickoff, the half-time lock and the rating-window open — each claimed once per user/match/stage so the minute loop never repeats itself, and each mapped to its own Profile switch
- Localized bot pushes (`server/messages.ts`): copy is rendered per **recipient** from `users.language`, which each device reports via `POST /api/me/language`, so the bot speaks the same language as the app
- Pinned timeline comments: composer on the match Timeline tab (pin to an event or minute, 500 chars, optional https clip link), pins rendered under their event, comment counts surfaced, your own cards highlighted
- Referral/invite mechanic: one reusable invite code per account, redeemable once per account, paying the referrer on the GLOBAL board only (capped per invite count) — `server/scoring/referral.ts`, surfaced in Profile with copy in both languages
- League tables for **every** followed domestic league, not just the big five: `buildLeagueTabs` derives the Table tabs from `followed_leagues`, and `syncStandings()` sweeps `ALL_DOMESTIC` (11 leagues). Understat xPts remain big-five only, so the Expected view hides itself where there is no data rather than showing dashes
- Inline Adsgram Task card (Telegram-only, opt-in via `VITE_ADSGRAM_TASK_BLOCK_ID`) — see the note below
- Guest/device accounts with full merge-on-upgrade, username-only login, Telegram initData auth, admin sync/notify endpoints

Removed: the curated `versus_pairs` admin path (endpoints + table, dropped by migration) — Versus Mode is the user-chosen pair in the prediction payload.

> **Corrections to older notes.** `roadmap.md` previously listed referral/invite, ads and "tables for a followed league outside the big five" as unstarted, and `data-model.md` marked `timeline_comments` as cut. All four shipped; the code was right and the docs were stale. Where the two disagree, the code wins.

**No longer dormant — the server-only features have UI:**

- Per-user prediction history (`GET /api/me/predictions`) and the resolver's `breakdown` payloads now render as the "why did I get X" panel (`src/pages/Predictions.tsx`, reached from Profile), including the Shot Predictor's `zoneFromFallback` and `lenientSoT` leniency flags, plus a live open/locked state per pending pick (the server builds the window from the same rules the write gate enforces)
- The lineup-drop push fires on the robust published signal (formation or both XIs' starters) and names every mechanic it opens (shot, watch, versus, subs), converting the gate into an action

**Not started:**

- (nothing outstanding from the original feature list — referral, ads, cup bracket trees and tables for followed leagues all shipped; see the notes below)

**Knockout brackets ship too.** `src/lib/bracket.ts` builds a connected tree from ESPN's round labels — rounds ordered first-leg → final, ties folded onto their second legs, winners inferred from the scoreline, and each round's entrants linked back to the feeder matches that produced them. The Cups screen renders it whenever a competition carries round data, and falls back to the flat live/upcoming/results sections when it doesn't.

(Ads: the inline **Adsgram Task card is live** on Matchday and Match detail — Telegram-only, and off entirely unless `VITE_ADSGRAM_TASK_BLOCK_ID` is set (`src/lib/ads.ts`). Rewarded/interstitial formats are deliberately unused.)

## Screens

- **Matches** (`#/matches`) — matchday list, live/upcoming/finished, your clubs first, "my teams only" filter
- **Match detail** (`#/match/:id`) — timeline, stats, lineups, ratings tabs
- **Onboarding** (`#/onboarding`) — the club & league picker: one anchored favorite, up to four more clubs, up to five national teams on their own shelf, and up to five leagues. A single-screen intro (the three ideas as one list) precedes it on first run. Old `/my-teams` deep links redirect here; Profile re-opens it for edits.
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

## Deploy

`render.yaml` is a working Render blueprint: one Node service, `npm install && npm run build` to produce `dist/` (frontend) + `dist-server/` (server), then `node dist-server/server/index.js`.

- **One process serves everything.** The API mounts the built `dist/` with an SPA fallback, so there is no separate static host to configure.
- **Exactly one instance** (`numInstances: 1`). File-based SQLite plus in-process cron loops (sync, resolver, retention, backup) mean scaling horizontally would fight itself — scale the box, never the count.
- **Persistent disk** (`disk:` block, mounted at `/var/data`). Without it `/var/data` is ephemeral and **every deploy/restart resets the database** — this is the single most important line in the blueprint. A disk pins the service to one instance (Render's own constraint, which matches the design) and disables zero-downtime deploys: the old instance stops before the new one starts, a few seconds of downtime per deploy. Disks need a paid instance type, so the blueprint is no longer on the completely free tier.
- **Health check** is `GET /health` (503 if the DB stops answering, so the check can actually fail).
- **Secrets live in the dashboard**, not in `render.yaml`: `TELEGRAM_BOT_TOKEN`, `MINI_APP_URL`, optionally `ADMIN_TELEGRAM_IDS`.
- **`NODE_ENV=production` refuses to boot while `DEV_AUTH_SECRET` is set** — that key turns `dev:<id>` tokens into any user's identity. Unset it before deploying.
- After the first deploy, point BotFather's Mini App URL (and `MINI_APP_URL`) at the service's `https://` URL.

## Backups

The database is a single file on the persistent disk, so the backup story has three layers:

1. **Render's automatic disk snapshots** — once every 24h, kept for at least seven days. Free with the disk. Restore a whole disk from the service's Disks page (restores the entire disk, not one file). This is the outer safety net for the case where the app itself is down.
2. **A nightly app-level snapshot** — `server/backupSchedule.ts` runs one `VACUUM INTO` snapshot (the same code path as `npm run backup`) at `BACKUP_HOUR` (UTC, default `3`) into `BACKUP_DIR` (default `/var/data/backups` on Render), keeping the newest `BACKUP_KEEP` (default 7). It lives **inside the server process** on purpose: a Render cron job is a separate container and **cannot mount this service's disk** (Render: "You can't add a disk to a cron job service", "you can't access a service's disk from any other service"), so it could never see `/var/data/matchday.db`. These files give a fast, granular, point-in-time restore.
3. **Off-site copies** — wired up with `git`. After each nightly snapshot, `server/backupSchedule.ts` copies the snapshot into the repo's `backups/` folder and runs `git add` → `git commit -m "Nightly DB backup"` → `git push`, so the off-site copy lives in a private GitHub repo (free, no credit card). Set `BACKUP_GIT_URL` in the dashboard to the repo URL with the token embedded (e.g. `https://<token>@github.com/you/vkick.git`); the app reads it from the environment and never hardcodes it. A git identity is supplied per-command, so the commit works on a fresh clone. The push is best-effort: if `git` is missing, the URL is unset, or the push fails, the scheduler logs a warning and the local snapshot still stands.
   Keep the token scoped to this repo, never in `render.yaml`, and store the copy **outside** the Render account/region.

**Restore (stop the server first):**

```bash
npm run backup:restore -- /var/data/backups/matchday-YYYYMMDD-HHMMSS.db /var/data/matchday.restored.db
# then point SQLITE_PATH at the restored file and check /health before trusting it
```

The CLI refuses to overwrite an existing file, and materialising through `VACUUM INTO` validates the snapshot — a corrupt backup fails the restore instead of being copied into place.

`npm run backup` and `npm run backup:restore` load `.env` (via `server/env.ts`), so they use the same `SQLITE_PATH`/`BACKUP_*` configuration as the server.

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
