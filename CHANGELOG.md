# Changelog

## Unreleased (player-visible — goes into WHATS_NEW)

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

### Added

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
