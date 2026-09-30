# Build Roadmap — Vkick

Scope: the big five leagues plus any other league ESPN covers that users can follow (the follow list is not league-restricted), and — since the catalog was widened — the club cups, the UEFA club competitions and international tournaments.
Data source: ESPN unofficial API (`site.api.espn.com/apis/site/v2/sports/soccer/{league}/...`), no key required.
Concept: `concept.md`. Mechanics: `prediction-mechanics.md`. Scoring: `scoring-rules.md`.

> **Reconciled 2026-09-29 against the code.** These boxes used to be aspirational — most of Phase 0–3 was shipped while the file still read as a plan, which is why the README calls the phase notes stale. Every `[x]` below was re-verified in the source, and items whose original wording overstated what exists have been **split** into what shipped and what is genuinely left. A `[x]` now means "in the code and reachable by a user", not "someone intended it".

---

## Phase 0 — Foundation (Week 1) — **complete**

**Goal:** a working data pipeline and empty app shell before any feature work.

- [x] Database schema (`data-model.md`, `server/db/schema.ts`): `teams`, `players`, `matches`, `gameweeks` (grouping only, no deadline), `favorite_teams` (anchor flag, ≤5, no per-league rule, enforced server-side), `followed_leagues` (≤5), `crowd_ratings` (rating + comment, 3-per-match cap in the API), `timeline_events`, `predictions`.
  - The schema outgrew this list as later phases landed: `timeline_comments`, `point_ledger`, `user_point_totals`, `user_streaks`, `streak_evaluations`, `user_sessions`, `user_credentials`, `user_notification_prefs`, `team_understat_stats`, `player_understat_stats`, `team_shot_situations`, `bot_push_queue`. `npm test` covers the migrations (`tests/migrate.test.ts`), including the pre-anchor and NOCASE-rebuild paths.
- [x] ESPN polling service (`server/espn/client.ts`, `server/sync/service.ts`): scoreboard sweep per competition across a date window, per-match summary fan-out during live windows, normalization insulation layer (`server/espn/normalize.ts` — the only file that knows ESPN's shapes).
  - The window is **per competition** (`pollWindow` in `server/espn/types.ts`): 21-day lookahead for the big five and club cups, one week for the international/short-calendar long tail. Widening the catalog without this multiplied the sweep's request count.
- [x] Manual override / patch path: the `npm run sync` CLI (`server/cli.ts` — `sync-all`, `sync-match`, `standings`, `--dry-run` backfills) plus `POST /api/admin/sync`, `/sync-window`, `/notify`.
- [x] Telegram bot (`server/bot/index.ts`): `/start` with the Mini App button, `/myteams`, server-side initData verification, and the push-queue drain. Well past the "shell + placeholder commands" this item asked for.
- [x] Web app skeleton: routing, auth gate, tab shell, and the first pass of every screen (`src/App.tsx`).

**Exit criteria met:** real fixtures, results and standings from multiple competitions flow into the database and refresh automatically.

---

## Phase 1 — My Teams & My Leagues Loop (Weeks 2–4) — **complete**

**Goal:** the following backbone — five clubs (one anchored) plus five followed leagues reorder the whole app.

- [x] Seed teams + players from ESPN rosters (`syncRosters()` in `server/sync/service.ts`, weekly + on demand; cup-only clubs resolve their competition from their most recent fixture).
- [x] Onboarding flow in the concept's order — favorite club → up to 4 more → up to 5 leagues — as one continuous 3-step flow (`src/pages/Onboarding.tsx`), with the animated intro gated on its own `localStorage` flag.
- [x] Persist `favorite_teams`: max 5, exactly one anchor, machine-readable error codes (`ALREADY_FOLLOWING`, `MAX_CLUBS`) so the UI toasts instead of failing silently.
  - Clubs outside the big five — cup-only sides and national teams — are followable too. The gate used to reject any team with an empty `league`, which made everything outside the big five unfollowable; the picker now groups them (`src/lib/pickerGroups.ts`).
- [x] Persist `followed_leagues` (max 5, any covered ESPN slug, `LEAGUE_NOT_COVERED` for unknowns).
- [x] Home: per-club fixture strip (live score / next kickoff / last result), anchored club first, favorites-first ordering, and the "my teams only" filter (`src/pages/Matches.tsx`).
- [x] League tables screen: standings with the user's clubs highlighted and a summary strip that jumps to them (`src/pages/Table.tsx`).
- [ ] **Tables for the leagues a user actually follows.** The picker is hard-wired to the big five (`TABLE_LEAGUES`) and `syncStandings()` loops `LEAGUES`, so a followed league outside the big five has no table to show. Cups correctly have none.
- [x] Profile / settings screens (`src/pages/Profile.tsx`): account, display name, EN/FA with RTL, notification prefs, haptics, version + what's-new.

**Exit criteria met:** each user picks an anchor club + 4 more and 5 leagues, and their matches lead the feed with correct tables.

---

## Phase 2 — Predictions + Leaderboards (Weeks 5–8) — **complete**

**Goal:** the stakes layer — pre-match mechanics live and points flowing into the three boards.

- [x] `predictions` table + per-mechanic lock windows (`prediction-mechanics.md`, `lockWindowFor()`): Lineup 2h before kickoff; Player to Watch, Versus and Shot at kickoff; Sub opens at lineup drop and locks at half-time — enforced against a real `halftime` match status, not a clock guess.
- [x] Server-side resolver for all five mechanics — point math as pure functions in `server/scoring/predictionScore.ts` per `scoring-rules.md`.
- [x] **Points ledger + leaderboards:** global, per-league, per-club, maintained incrementally in `user_point_totals` by `server/scoring/ledger.ts`; any prediction auto-feeds its match's league and both clubs' boards; streak bonuses feed global.
- [x] Tiebreaker: `reached_total_at` recorded at award time; rank level totals by who got there first.
- [x] Public, browsable board screens (`src/pages/Leaderboards.tsx`) over three no-auth endpoints (global / league / club). Identity is the unique `@username` (display name only as fallback, since names collide on a public board); the caller's own row is flagged `is_you` and highlighted.
- [x] Season **scoping**: every ledger and totals row carries `scope_season` and reads filter on `currentSeasonLabel()`, and `rollSeasonIfNeeded()` resets a user's streak when their row carries the previous label — so the three views move together.
- [ ] **Season boundary exactly as specified** — "closes when the last tracked league finishes". What exists is a calendar rule (Aug–May European year), not a rule driven by the final tracked league's last fixture, and it has no test. See Phase 4.
- [x] Transparent "why did I get X" breakdown panel: `src/pages/Predictions.tsx` over `GET /api/me/predictions`, rendering the resolver's own stored `breakdown` line items (`src/lib/breakdown.ts`), including the Shot Predictor's `zoneFromFallback` and `lenientSoT` leniency flags.

**Exit criteria met:** predictions resolve correctly after a real matchday and the three boards update; a user can find themselves on all three.

---

## Phase 3 — Ratings + First-Half Mechanics (Weeks 9–12) — **complete**

**Goal:** the eye test and the two mechanics that need live data plumbing.

- [x] Post-match 3-card rating UI: pick **any 3** players from those who featured, 1–10 + comment per card, cap enforced in the API (`MAX_RATINGS_PER_MATCH`, `RATING_CAP_REACHED`) and surfaced as `cardsUsed`/`cardsMax` (`src/components/panels/RateSheet.tsx`).
- [x] Aggregate crowd rating per player (average across users, minimum vote floor) shown beside the stat score on every player card — the Metacritic critic-vs-user model — plus the divergence-sorting eye-test page (`src/pages/Ratings.tsx`).
- [x] Sub Predictor: opens when the official lineup drops, editable until half-time, one whole-board submission, resolves +1/+1 per sub-pair (`src/components/panels/SubBoard.tsx`).
- [x] Shot Predictor: single player + zone pick (6-zone grid), locks at kickoff; adjudication from `details[]` `fieldPositionX/Y` with the on-target bonus from the stat sheet.
- [x] ~~Define the Shot Predictor formula in `scoring-rules.md`~~ — locked: 6-zone grid, exact 5 / adjacent 2 / +2 SoT / +5 goal (§3).
- [x] Player to Watch: crowd-rating component (stat gate + crowd gate, votes ≥ 5) + the MVP bonus (highest stat score in the fixture).

**Exit criteria met:** player cards show divergent stat vs crowd verdicts, the Sub Predictor pays out across real subs, and all five mechanics resolve end-to-end.

---

## Phase 4 — Polish & Distribution Prep — **in progress**

**Goal:** ready for people outside your immediate friend group.

- [x] Goal alerts: detection in the sync, per-club fan-out to followers, delivered by the bot's push-queue drain, gated at queue time **and** send time by `user_notification_prefs` so opting out is a real switch.
- [x] The rest of the matchday notifications (`server/notifications.ts`): the lineup drop ("the Sub Predictor is open"), the last call before kickoff, the half-time lock, and the rating-window open after full time.
- [x] Visual/UX hardening pass (2026-09-29 audit): contrast-aware ink on team-coloured discs (`readableInk`, PlayerStats + replay pins), a 44px replay scrubber, 44px targets on every text link (Login, Onboarding, Cups, Table rows, Predictions, Profile), RTL back chevron that mirrors in Persian, stake-framed leaderboard empty state, and cup round groupings (first round → final) backed by the new `matches.round` column.
  - Every stage is **claimed once per (user, match, stage)** in `match_notifications`, because the producer runs on the minute loop against matches that sit inside their window for up to two hours — without the claim, "kicks off in 40 minutes" arrives forty times.
  - Freshness windows (6h back, 2h ahead) stop a first boot against a database of historic fixtures from queueing months of reminders.
  - Each kind checks its own Profile switch (`PREF_COLUMN`), so muting goal alerts leaves lock reminders intact.
  - Copy is rendered per **recipient** from `users.language` (`server/messages.ts`), so the bot speaks whichever language the app is showing.
  - Covered by `tests/notifications.test.ts`, including the pre-`kind` and pre-`language` migrations.
- [ ] Ad integration (Tapsell) at natural break points — post-pick onboarding, league tables, post-match reveal — never mid-match.
- [ ] Referral/invite mechanic: share your club/league picks or a leaderboard link (likely the primary growth channel).
- [ ] Bug bash / stability pass across the full loop (onboard → predict → live match → rate → check rank). `npm test` covers the pure logic (scoring, grid, formations, normalization, migrations, password) but nothing exercises the live loop end to end.
- [ ] Leaderboard season-reset tested against a synthetic boundary. Nothing in `tests/` covers the season rollover today.

**Exit criteria:** a stranger could sign up via a shared Telegram link and understand what to do within a minute or two, unassisted.

---

## Phase 5 — Soft Launch (Week 15+)

**Goal:** validate with real usage before wider promotion. **These are launch activities, not build items** — nothing here can be ticked off from the code.

- [ ] Launch to your existing football-fan friend group for one full matchday cycle
- [ ] Watch specifically for (these are `concept.md`'s success signals):
  - ESPN endpoint reliability under real (if small) load — now across the big five, the cups, the UEFA competitions and international tournaments, each with its own polling budget
  - Onboarding completion: favorite club → 4 more → 5 leagues, or bounce partway?
  - Which of the five prediction mechanics get played most, and which get ignored
  - Does the leaderboard drive repeat predictions, or do people predict once and never check rank again?
  - Do people actually use their 3 rating cards per match, or does that go unused?
- [ ] Only expand the league catalog further once the core loop is proven with real users

---

## Two risks to actively manage throughout, not just at the end

1. **ESPN's API is unofficial.** The manual-override fallback from Phase 0 must actually stay wired up, not get skipped for speed — it is (`npm run sync` CLI + `/api/admin/*`). Re-check response shapes periodically: "any league ESPN covers" multiplies the normalization layer's surface area every time someone follows an untested league, and the catalog now covers 26 competitions instead of 14.
2. **The engagement bets are unproven.** If any single mechanic, the leaderboard loop, or the 3-card ratings show near-zero engagement after a full matchday cycle with real users, don't sink Phase 4–5 polish time into features nobody's touching — cut back to the following core (clubs, leagues, fixtures, tables).

---

## Surrounding docs that have drifted

Found while reconciling this file; left alone deliberately, but they contradict the code:

- **`data-model.md`** still marks `timeline_comments` as `~~cut~~`, but pinned timeline comments shipped (table + endpoints + composer). Same file may predate other additions listed in Phase 0.
- **`README.md`** lists the prediction history and breakdown payloads as "Dormant — built on the server, no UI yet" and calls the phase notes stale; the first half of that is no longer true now that the panel renders, so the README should be read against this file rather than independently.
