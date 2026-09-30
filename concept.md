# Product Concept — Vkick

## One-line pitch
A Telegram-distributed football companion: follow your favorite club plus up to four more, follow up to five leagues from anywhere ESPN covers, predict lineups/subs/shots/standout players/head-to-heads before and during each match, then rate the players who mattered most — all feeding season-long prediction leaderboards.

## This is not a fantasy game
No squads, no budget, no transfers, no captaincy, no private fantasy leagues. Users follow clubs, not draft players. The five per-match prediction mechanics below are light, risk-free calls on a single match, and they roll up into season-long prediction leaderboards. This is a prediction leaderboard, not a fantasy points/squad system — that distinction stays firm.

## The problem with existing football apps
- **Fantasy games (FPL, etc.) are heavy.** Budgets, transfers, captaincy and a weekly admin ritual ask casual fans to manage a second job before they can care about the match itself.
- **Stat sites (WhoScored, Sofascore) are purely stat-driven.** A player can put up big numbers while playing poorly, or grind out a great defensive performance with zero stat-sheet return. Fans know the difference — but nowhere lets them express it in a way that feeds back into the product.
- **Nobody owns the live moment.** Existing apps treat the match as a static result to review afterward, not a living thing fans want to react to minute-by-minute together.

## Onboarding
1. **Pick your favorite club** (one) — this is the anchor club, shown first everywhere.
2. **Pick up to four more clubs** (five total, no per-league restriction) — the whole app reorders around this set: home strip, fixtures, league tables all highlight them.
3. **Pick up to five leagues to follow** — any league ESPN's API covers, not limited to the big five. Followed leagues determine what shows up by default in the matchday list and tables view.

## The four pillars

### 1. My Teams & My Leagues (the reason to open the app)
- Home screen strip showing each of your five clubs' live score / next fixture / last result; your matches sort first everywhere; a "my teams only" filter narrows the whole matchday list
- League tables for each of your five followed leagues, with your clubs highlighted where they appear
- The habit loop: your clubs and leagues kick off at different slots across the week, so there's almost always a reason to open the app

### 2. Predictions + Leaderboards (the stakes layer)
Five per-match mechanics. All of them are the **only** source of leaderboard points — ratings and comments never contribute.

**Lineup Predictor**
- Predict the starting XI + formation before the official lineup is announced
- Locks 2 hours before kickoff
- Points per correct player named in the XI, bonus for exact formation match

**Sub Predictor**
- One submission per match: predict all expected substitutions for the match at once (who comes off, who comes on, for each of the legal substitute slots)
- Opens once the official lineup drops; stays open and editable until half-time, so users can adjust based on how the first half plays out
- Locks at half-time
- Scoring per predicted sub-pair: 1 point for correctly naming the player subbed off, 1 additional point for correctly naming their replacement

**Shot Predictor**
- Pick one player and one location on a pitch grid where you predict their next shot will come from
- Opens once the lineup is confirmed, locks at kickoff
- One player, one location guess per match
- Scoring is formula-based on three factors: whether it results in a goal, how close the predicted point is to the actual shot location, and shot accuracy/quality from that zone — closer and more accurate predictions score higher, not fixed flat tiers (exact formula to be defined in `scoring-rules.md`)

**Player to Watch**
- Pick one player you expect to stand out
- Opens once the lineup is confirmed, locks at kickoff
- Points based on **both** that player's stat score and their crowd rating from the post-match 3-card system; extra bonus if that player is named match MVP
- MVP definition: the match MVP is the player with the highest single-fixture stat score in that match; a bonus applies if your Player to Watch pick is that player

**Versus Mode**
- Pick two players from the same match, one from each team
- Predict which of the two has the better performance
- Locks at kickoff (pre-match pick only, no adjusting once the match starts)
- Resolved by stat score only — no crowd-rating input, so it's an objective, fast-resolving mechanic distinct from Player to Watch

### 3. Leaderboards
- **Global** — every user's full point total across every prediction made all season, regardless of league or club
- **Per-league** — total points from predictions made on matches within that league
- **Per-club** — total points from predictions made on matches involving that club
- **Eligibility** — no following requirement; any prediction on any match counts toward that match's league and both clubs' leaderboards automatically
- **Tiebreaker** — level scores ranked by whoever reached that total first
- **Visibility** — public, browsable by anyone (usernames + scores), no gate
- **Season boundary** — one unified season per year: opens when the first of the user's trackable leagues kicks off, closes when the last one finishes; all leaderboards reset together at that boundary

### 4. Post-Match Ratings — the "eye test"
- After full-time, each match shows every player who featured
- The user picks **3 players of their choice** from that match to rate
- Each of the 3 gets a 1–10 score plus a comment
- Resets every match — 3 new cards per match, no cap across matches or the season
- **Cosmetic only** — no leaderboard points, ever
- Aggregate crowd rating per player = average of all submitted scores across all users, shown alongside the stat score on every player card (Metacritic critic score vs. user score model)

## How the pillars reinforce each other
- Five clubs × five leagues = fixed reasons to open the app most days of the week; the strip and filter make the raw matchday list personal
- Player to Watch ties the crowd's post-match verdict directly to a prediction's outcome, linking pillars 2 and 4
- Versus Mode gives a fast, purely objective mechanic alongside the more subjective, crowd-informed Player to Watch
- Leaderboards give all five mechanics a season-long reason to keep playing without needing squads or budgets to do it
- The 3-card rating system keeps the "eye test" alive without letting it distort competitive scoring

## Target audience (v1)
Football fans in Iran (Telegram-native distribution). Any-league coverage via ESPN's API means there's rarely a dead matchday. Expandable to any Persian-speaking or broader football-fan audience once proven.

## Distribution & monetization
- **Distribution:** Telegram Mini App (zero app-store gatekeeping, built-in virality via sharing/groups) + a companion web app for richer prediction/picker UI that doesn't fit well in Telegram's webview
- **Notifications:** Telegram bot pushes ("your club just scored," "lineup dropped, Sub Predictor is open," "rating window is open")
- **Monetization:** Local ad network (Tapsell) integrated between natural break points — post-pick onboarding, league tables screen, post-match reveal — never mid-match
- **Payments (future, if needed for premium features):** Zarinpal or crypto (USDT), given Iran constraints

## Data source
ESPN's public (unofficial) API — `site.api.espn.com/apis/site/v2/sports/soccer/{league}/...` — confirmed working, no key required, no cost. Covers league scoreboards/fixtures/results, full match summaries (team + player stats, lineups/formations, minute-by-minute events, shot coordinates) across essentially any league ESPN tracks, which is what allows the "any league" follow list.

**Risk to design around:** this API is unofficial and undocumented. It could change or break without notice. The system must have a manual data-entry fallback path so the product doesn't go dark if ESPN changes something.

## Explicit non-goals for v1
- **No fantasy mechanics** — squads, budgets, transfers, captaincy, private fantasy leagues remain cut. Leaderboards rank prediction points only.
- **No pinned minute-comments / timeline reactions** — the old live-timeline pillar was cut; the timeline stays read-only match data
- No live betting/odds features (data is present in ESPN's response but out of scope)
- No native iOS/Android app — Telegram + web only
- No real-money prize pools initially — free-to-play with ad monetization only, to avoid gambling-adjacent legal complexity

## Open item for scoring-rules.md
- Exact formula for Shot Predictor's proximity/accuracy-based scoring still needs to be defined numerically (zones, distance decay, or continuous formula). Once defined in `scoring-rules.md`, it is the source of truth the server resolver implements.

## Success signals to watch for in soft launch
- Do people finish onboarding (favorite club → 4 more → 5 leagues), or bounce partway?
- Does the club/league strip bring people back on matchdays?
- Which of the five prediction mechanics get played most — and which are ignored?
- Does the leaderboard drive repeat predictions, or do people predict once and never check rank again?
- Do people actually use their 3 rating cards per match, or does that go unused?

If any single mechanic or the rating system shows near-zero engagement after a full matchday cycle with real users, that's a signal to cut scope back to the core (club/league following, fixtures, tables) rather than keep building unused features.
