# Changelog

## Unreleased (player-visible — goes into WHATS_NEW)

### First run & navigation

- **The intro is one screen, not three.** A first-timer used to step through
  three intro slides and then three picker steps before seeing a fixture. The
  three ideas are now a single scannable list on one screen, so it is four
  screens to the first fixture instead of six.
- **Trailing chevrons now point the right way, and mirror in Persian.** The
  cards that open Predictions, Replay, Ratings and Player Stats were drawing a
  left-pointing chevron as a forward affordance in English (and a right-pointing
  one in Persian); the Browse competition rows' `›` never flipped. They all use
  one end-edge chevron that flips in RTL, matching the Profile rows.
- **Three more bits of copy are localized.** The club-picker tab strip's label
  (announced to screen readers), the tables' gameweek count, and the Profile
  version line's "Telegram Mini App" / "Web" now read in the user's language
  instead of English-only.

### Leagues & alerts

- **Favorite leagues are pickable from the Matchday feed.** Following a league
  was only reachable inside first-run onboarding, so a returning user had no way
  to add the Champions League to their feed. A chip at the top of Matchday —
  "Pick your leagues", or "Edit" once something is followed — opens a sheet
  listing every competition in the catalog (leagues, cups and international
  tournaments, filterable), with the followed ones pinned to the top of their
  section. The chips behind it re-scope the whole feed, crossfading into the
  chosen competition.
- **Following a league now means following its alerts, not just its scores.**
  The push producers only ever looked at `favorite_teams`, so a followed
  competition was silent — you had to favorite a club to hear about a goal. The
  matchday stages (lineup drop, last call before kickoff, half-time, rating
  window) and goal alerts now also fan out to the competition's followers, cups
  and international tournaments included, because a followed cup is an ordinary
  `followed_leagues` row. Following both a club and its league still sends
  exactly one push, and the Profile switches and the Telegram-deliverability
  rule apply unchanged.

### Boards & Browse

- **Your standing now leads the leaderboard.** The boards opened on a list of
  strangers; the viewer's own rank and points, when they have any, now sit at
  the top of the board as a summary line, above the top-100 page. The
  below-page "you" row was folded into it, so you can no longer appear twice.
- **Browse no longer lists a promoted league twice.** Eredivisie, Liga
  Portugal, Süper Lig and the Scottish Premiership had stayed in the
  browse-only "coming soon" list after their fixtures and tables shipped, so
  each rendered twice on Browse — once as "live scores", once as "not in your
  feed yet", under a duplicate key. A slug now belongs to exactly one list.
- **A club's Season tab reads honestly when there's nothing to show.** "Season
  stats not built yet" is now "No season stats yet"; the feature is done, the
  data simply has not arrived.

### Cups & internationals

- **International tournaments are now selectable in the Cups screen.** The
  picker was filtered to `kind: "cup"`, so the World Cup, Euros, Nations League
  and the qualifiers only appeared if you deep-linked them from Browse, and you
  could not switch between them. A Cups / International toggle now swaps the
  competition strip (it follows a deep link, so Browse's tournament rows open
  onto International), and every one of them is watchable: open the match or
  hit Replay like any club fixture.
- **Cup and international matches show the competition's real name.** The match
  detail and replay headers rendered the raw slug for anything outside the big
  five ("uefa.champions", "fifa.world"); they now read the catalog's own name
  (localized) via a cached competitions lookup.

### Replay

- **The replay ball now follows the whole match, not a handful of points.** The
  ball path was built from the stored timeline's shot coordinates, and ESPN only
  publishes those for goals — so a three-goal match shuttled the ball between
  three spots for ninety minutes. The path now folds in every positioned moment
  the commentary describes (shots, corners, free kicks, fouls) through the same
  parser the live pitch uses, and interpolates between consecutive moments. No
  positions are invented: the extra detail is the commentary's own zone language.
- **Per-match expected goals on the replay pitch.** New `match_understat_stats`
  table (one row per match and club) feeds an xG card under the transport:
  each side's xG in the evaluation colour, with a club-coloured share bar. ESPN
  publishes no expected goals, so the values come from Understat — a club
  outside the big five, or a fixture that didn't pair cleanly, shows "no data"
  rather than a zero. The weekly league Understat walk fills the table, pairing
  each club's history to its finished matches by side, scoreline and kickoff
  date and dropping anything ambiguous.

## Unreleased (infra — kept out of WHATS_NEW, players can't see any of this)

### Code health

- **Dead client mirrors of the server catalog removed.** `useApi.ts` exported
  `LEAGUE_TABS`, `CUP_SLUGS`, `TOURNAMENT_SLUGS`, `isCupSlug`, `LEAGUE_SLUGS`
  and `CompetitionRow`, none of which had a caller: they duplicated the server
  catalog (`server/espn/types.ts`) and would drift the moment a competition was
  promoted. The one identity helper `toRawMatch` in `Ratings.tsx` is gone too.
- **The competitions catalog is a tested pure module.** `competitionCatalog()`
  (`server/espn/catalog.ts`) builds the Browse list from `COMPETITIONS` plus the
  browse-only extras and dedupes by slug, and `tests/competitions.test.ts`
  pins the invariant that broke once: the two source lists are disjoint, every
  competition advertised as synced is actually in `LEAGUES_ALL`, and extras are
  always `comingSoon` with no table. `/api/competitions` now calls it instead
  of rebuilding the merge inline.
- **`server/index.ts` split into route modules.** One module per domain under
  `server/routes/` (`auth`, `me`, `football`, `predictions`, `ratings`,
  `leaderboards`, `admin`) with shared plumbing in `server/routes/shared.ts`;
  the app shell keeps middleware, `/health`, static serving, retention sweeps
  and boot. No endpoint path or behavior changed — typecheck, the full test
  run and a live boot + guest-entry smoke test all stayed green.
- **Auth hardening.** initData digest comparison is constant-time and
  `auth_date` is required (≤24h); the server refuses to boot with
  `DEV_AUTH_SECRET` set under `NODE_ENV=production`; ratings/comment writes
  are rate-limited; `trust proxy` is pinned to one hop. A temporary probe on
  `/api/auth/guest` logs verification verdict + identity mode (no secrets)
  while real-Telegram-client behavior is being observed.
- **UX truth fixes.** The RateSheet histogram is the server's real per-rating
  GROUP BY (was a single-bucket client approximation); leaderboards surface a
  server-computed "your rank" row when it sits below the top-100 page;
  prediction summaries show localized player names instead of raw ESPN ids;
  the ErrorBoundary and the bot's `/start` + `/myteams` replies are localized
  (EN/FA); rating rows carry the match's real competition instead of a
  hardcoded PL.
- **Docs de-staled.** The Screens list shows Onboarding (the live picker)
  instead of the removed My Teams screen; the not-started list reflects that
  the inline Adsgram Task card is live (Tapsell was the old plan); the API
  surface section names both bearer-token families and the favorites caps.
- **Season boundary is data-driven (scoring-rules.md §8).** New
  `activeSeason()` (`server/scoring/season.ts`): the active label follows the
  most recent tracked-league kickoff, so the season closes when the last
  tracked league finishes and opens at the next one's first kickoff — not on
  Aug 1. Summer internationals keep scoring into the finished season's boards;
  future fixtures never flip the label early. Ledger stamps, leaderboard
  reads and streak rows all use it; `tests/season.test.ts` pins the
  summer-gap case where the data rule and the calendar disagree, the flip,
  award stamps, and the synthetic-boundary streak roll.
- **Shot Predictor formula finalized with pinned leniency tests.** The
  formula was locked (exact 5 / adjacent 2 / +2 SoT / +5 goal, best single
  shot pays); the two leniency rules are now pinned as executable spec —
  `lenientSoT` scores **exactly +2** when no located shot exists, and the
  adjacency-only path pays exactly the zone points — and `scoring-rules.md`
  §3 documents both flags (`lenientSoT`, `zoneFromFallback`) as locked
  behavior rather than agent caveats.

### Tooling & performance

- **All `react-hooks/exhaustive-deps` warnings cleared.** `Cups` and
  `Onboarding` rebuilt their derived arrays (and their memos) every render; the
  list sources are memoized now. `useAuth` memoized `isRemembered()` on the
  wrong dependency; it is a plain cheap call again.

- **Route-based code splitting.** Every screen except Login is now `React.lazy`,
  with a `Suspense` boundary inside AppShell around the Outlet (so the tab bar
  stays put while a chunk loads) and vendor chunks for React/router and the
  query client. The single ~500 kB bundle became a ~35 kB gzip entry plus
  cacheable vendor chunks and per-route chunks.
- **Build target for the target devices.** `build.target` is es2019 (Telegram's
  Android webviews lag the newest Chrome); `cssTarget` chrome61.
- **ESLint + Prettier.** Flat `eslint.config.js` (typescript-eslint recommended,
  react-hooks, react-refresh) and `.prettierrc.json`, wired as `npm run lint` /
  `format` / `format:check`. Lint found and cleared 7 pieces of dead code
  (unused imports, an unused `today()`, an unused `LEAGUES` const). The repo is
  now Prettier-clean; 0 lint errors, warnings only for intentional `any` in the
  ESPN/Understat normalization layer and react-refresh file boundaries.
- **`/health` endpoint.** Unauthenticated liveness/readiness probe (checks the
  DB, returns 503 when it can't), for an uptime monitor or proxy.
- **One query cache.** `App.tsx` had a second `QueryClient` nested inside the
  one in `main.tsx` and silently won, disagreeing on `refetchOnWindowFocus` and
  `retry`. The config now lives only in `main.tsx`.

### Accessibility

- **Skip-to-content link** in AppShell, and `<main>` is a proper `#main-content`
  landmark (new `common.skipToContent` string, EN + FA).
- **BottomSheet focus trap.** The sheet moves focus into the dialog on open,
  traps Tab inside it, and returns focus to whatever opened it on close; the
  page behind it is no longer reachable by keyboard.

### Tests

- `tests/notifications.test.ts` — followed-league delivery: a competition
  follower with no club favorite is woken for its fixtures and its goals, a
  different league's fixtures are not, club + league follows dedupe to one
  push, and the per-kind opt-outs and guest/pwd/dev filter still apply.
- `tests/client.test.ts` — the Favorite Leagues picker's list algebra
  (`src/lib/leaguePicker.ts`): the cups tab carries the international
  tournaments, followed competitions sort to the top of their section, and no
  competition is dropped or duplicated.
- `tests/season.test.ts` — previous-season streak reset, current-season no-op
  and the no-row path (the untested season boundary the roadmap flagged).
- `tests/client.test.ts` — contrast-aware `readableInk`, the "why did I get X"
  breakdown rendering, and picker grouping. Required lifting the league slug
  maps into a pure `src/lib/leagues.ts` so they don't pull React through
  `hooks/useApi` (re-exported there unchanged).

### Fixed

- **Server boot on pre-anchor databases.** The anchor partial index
  (`idx_favorites_anchor … WHERE is_favorite = 1`) was created in the main
  schema exec, before the `is_favorite` column backfill — any database from
  before the anchor flag crashed the whole server at boot with
  `no such column: is_favorite`, so every client call (including username
  login) fell back to the generic error. The index is now created after the
  backfill, with duplicate anchors deduped first.
- **Username login validation.** Requests carrying a `username` key are now
  always treated as username attempts and shape-checked: bad shapes return
  `BAD_USERNAME` instead of falling through into the Telegram/dev path
  (`missing hash` / `no bot token`) or misreporting `NO_ACCOUNT`.
- **Toasts dismiss themselves again.** The leave class (`toast-out`) had no CSS
  rule at all, so the exit animation never ran and its `animationend` — the only
  thing that removed a toast — never fired either: every toast stayed on screen
  until a reload, and the Adsgram "Block is not active" error was just the most
  visible one (three stuck copies was the cap). The animation exists now
  (`src/index.css`), and the provider also reaps each toast on a timer, so a
  missing or undelivered animation event can never strand one.
- **A rejected Adsgram Task block takes itself off the screen.** The card now
  collapses (returns null) on the SDK's own error events and on an error thrown
  out of the SDK script or a rejected promise from it, and remembers for the
  session so a tab switch or route change cannot retry the same rejected block
  and raise it again. An unrelated page error leaves the placement alone, and a
  reload retries it, so a fixed block id comes back on its own.
- **Matchday never shows a wall of empty sections.** A fresh database (before
  the ESPN sync has filed a fixture) used to render Live, Upcoming and Previous
  as three empty boxes. The feed now renders one state at a time: a single
  labelled skeleton list while the first fetch is in flight, one error card if it
  failed with nothing cached, and one centered empty state — "No matches
  available right now. Syncing live scores — check back shortly!" with a Sync now
  action — when the sync has not filled the feed yet. Previous results are always
  offered and name "No results yet" when opened rather than vanishing, and an
  empty Upcoming keeps its action too. New copy ships in English and Persian.

### Added

- **The Adsgram Task card is the only ad unit, behind one switch.** Adsgram
  ships no banner format, so the `<AdBanner>` slots are gone and every ad now
  goes through the inline Task card (`src/components/TaskAdCard.tsx`). It renders
  nothing unless `ADGRAM_ENABLED=true` **and** a `task-…` block id is in
  `VITE_ADSGRAM_TASK_BLOCK_ID` **and** the app is inside Telegram — three gates,
  so the web build never loads the SDK. On Matchday it sits below the Upcoming
  feed and above Previous results, so it can never push the fixtures out of
  view; on Match detail it stays the last block on the page. Both env names work
  (`ADGRAM_ENABLED` is mapped in by vite.config, since Vite only inlines
  `VITE_`-prefixed vars itself; `VITE_ADGRAM_ENABLED` is read natively) and both
  are inlined at build time, so flipping the switch means a rebuild.
- **The Adsgram reward webhook is wired.** `GET /api/adsgram/reward?userId=…`
  answers `200 { status: "ok" }` so Adsgram accepts the Task card's completion
  callback, and logs the userId so the first real reward is visible in the server
  log. Nothing is credited yet — that is the next step, once an Adsgram userId can
  be mapped to an account.
- **Explicit username registration.** The Login screen has a Sign in / Create
  account switch wired to `POST /api/auth/register` (with guest-upgrade
  merge). Unknown usernames on sign-in stay `NO_ACCOUNT` — never auto-created,
  so a typo can't silently mint an account.
- **Username passwords (scrypt).** Registration and login take a password
  (8–72 chars, no composition rules; `BAD_PASSWORD` on violation). Hashes are
  scrypt with a random per-user salt and self-describing parameters
  (`server/auth/password.ts`); comparison is constant-time. Wrong password
  and unknown username return the identical `401 INVALID_CREDENTIALS`, and
  unknown names still cost one scrypt verification, so neither response nor
  timing reveals which usernames exist. Brute force is throttled by the
  existing per-username + per-IP credential limiter (`429 TOO_MANY_REQUESTS`).
  Telegram, guest, dev, and existing sessions are unchanged. No recovery
  channel yet — deliberately deferred, see open decisions.
- **Usernames are case-insensitive.** `user_credentials.username` is now
  `COLLATE NOCASE UNIQUE` (fresh DBs and a rebuild migration for old ones);
  lookups match in any casing while the stored casing is kept for display.
  Pre-check on the live database found zero existing usernames, so no
  collisions; the migration keeps the earliest row if any ever appear.

## 0.2.0 — Gameplay-rule enforcement + crowd thread (2026-09-28)

### Gameplay & scoring

- **Sub Predictor half-time lock is now a real server rule.** Added a `halftime`
  match status (ESPN's status detail text — "Halftime", "HT" — is the only signal
  the API publishes). The predictions endpoint rejects sub submissions with
  `SUB_LOCKED_HALFTIME` once the break is detected; previously the "editable until
  half-time" UI copy sat on top of an "editable until fulltime" rule. Sync hardening:
  halftime matches are never regressed to `scheduled`, and they are refreshed every
  minute so the HT→live flip arrives promptly. Accepted limitation: leagues whose
  payloads never carry an HT detail degrade to "live until FT" rather than failing.
- **Shot Predictor fallback is flagged, not silent.** When zone/goal points come
  from the all-shots fallback (a teammate's located shot, because ESPN did not
  publish the picked player's shot coordinates) the resolver records
  `zoneFromFallback: 1` in `predictions.breakdown`, alongside the existing
  `lenientSoT` stat-tally flag — visible in a future "why did I get X" panel and
  auditable if the leniency ever turns exploitable.

### Removed

- **Curated Versus pairs path removed entirely.** `POST /api/admin/versus`,
  `DELETE /api/admin/versus/:id`, and the read endpoint `GET /api/matches/:id/versus`
  are gone; the `versus_pairs` table is **dropped** by the schema migration on the
  next boot (fresh databases never create it). Versus Mode's shipped mechanic is the
  user-chosen pair in the prediction payload (`prediction-mechanics.md`) — no code
  path reads curated pairs anymore.

### Added

- **Server-enforced push preferences.** New `user_notification_prefs` table backs the
  Profile toggles (`GET/PUT /api/me/notification-prefs`). Goal alerts are filtered at
  queue time and again at send time, so opting out actually stops the messages; the
  admin notify endpoint refuses opted-out recipients (`409 RECIPIENT_OPTED_OUT`)
  rather than routing around their choice. Haptics remains a device-local setting.
- **Pinned timeline comments, end to end.** The server layer existed
  (`timeline_comments` + comments endpoints + https-only clip-link validation); the
  client now uses it: a composer on the match Timeline tab (pin to an event or a free
  minute, 500-char limit, optional YouTube/Instagram clip link), pinned comments
  rendered inside their event's slot in `TimelineList`, per-event and per-match
  comment counts surfaced, and your own cards highlighted.
- **Leaderboard identity is the unique `@username`** (from `user_credentials`),
  falling back to the display name for Telegram/guest accounts — display names are
  not unique and could collide on a public board. Boards are also viewer-aware:
  the caller's own row is flagged `is_you` (via session/initData/dev token) and
  highlighted client-side, closing the "find yourself on the board" gap without
  gating the public read.

### Docs

- README's stale "What's deliberately not built yet" section replaced with an
  accurate "What's built vs. what's not" (built / dormant / not started).
- This changelog started.

## 0.1.0 — Initial build

Core loop on real ESPN data: onboarding (anchor club → 4 more → 5 leagues),
matchday feed with live scores, match center (timeline/stats/lineups), all five
prediction mechanics with per-mechanic lock windows and server-side resolution,
points ledger feeding global/league/club season leaderboards with the
first-to-reach tiebreak, favorite-club streak thresholds, 3-card crowd ratings
beside stat scores, 2D match replay, Telegram bot with goal alerts and Mini App
button, guest/username/Telegram auth, admin sync/notify endpoints, manual sync CLI.
