# Scoring Rules

This is not a fantasy game: no squads, no budget, no transfers, no captaincy. Two point systems remain, both transparent by design — and every prediction point now flows through the **points ledger** into the season leaderboards (`prediction-mechanics.md`):

1. **Player stat score** — display-only on player cards, and the objective resolution source for Versus Mode, Player to Watch's stat gate, and the match-MVP definition. Nobody wins or loses anything by having a high stat score; it is the stat sheet, not a stake.
2. **Prediction points** — per-match rewards from the five mechanics (`prediction-mechanics.md`), plus the favorite-club **streak bonus**. Recorded per prediction on the `predictions` row, appended to the `point_ledger`, and **rolled up into the global / per-league / per-club leaderboards** via `user_point_totals`. Ratings and comments never contribute points to anything (see the firewall in §8).

These values are **locked** — the tables below are the single source of truth both the pure scoring module (`server/scoring/predictionScore.ts`) and the resolver implement. The `breakdown` JSON fields map directly to the line items so users can see exactly why a number is what it is.

## Position categories (for the stat score)

Map ESPN's granular position abbreviations to one of four categories (stored on `players.position`):

- **GK** — Goalkeeper
- **DEF** — Center Back, Left Back, Right Back, Wing Back, etc.
- **MID** — Defensive Mid, Central Mid, Attacking Mid, Left/Right Mid, Left/Right Wing
- **FWD** — Forward/Striker

## Player stat score

Calculated once per player per match, when `status = finished` (implemented in `server/scoring/statScore.ts`; output range roughly −6…+15, negative only from cards/own goals/conceded — this is the baseline the Watch thresholds below sit on).

| Condition | Points |
|---|---|
| Played 1–59 minutes | 1 |
| Played 60+ minutes | 2 |
| Did not play | 0 |
| Goal — GK / DEF | 6 |
| Goal — MID | 5 |
| Goal — FWD | 4 |
| Assist (any position) | 3 |
| Clean sheet — GK / DEF (team conceded 0, played 60+) | 4 |
| Clean sheet — MID (same conditions) | 1 |
| Per 2 goals conceded while on the pitch (GK / DEF) | -1 |
| Per 3 saves (GK) | 1 |
| Yellow card | -1 |
| Red card | -3 |
| Own goal | -2 |

The highest stat score in a fixture also defines that match's **MVP** (used by Player to Watch's bonus). Ties at the top: all tied players are MVP.

### Worked example

A midfielder plays 90 minutes, scores 1 goal, gets 1 assist, team keeps a clean sheet, receives 1 yellow card:
- Appearance (60+ min): +2
- Goal (MID): +5
- Assist: +3
- Clean sheet (MID): +1
- Yellow card: -1
- **Total: 10**

## Prediction points (locked)

Per match, resolved after the match (or the mechanic's window) closes:

| Mechanic | Action | Points |
|---|---|---|
| Lineup Predictor | Each correctly predicted starter | +1 (max 11) |
| Lineup Predictor | Exact formation right | +5 |
| Sub Predictor | Per predicted sub-pair: correct player off | +1 |
| Sub Predictor | Per predicted sub-pair: correct replacement as well | +1 (so +2 per fully correct pair) |
| Shot Predictor | Predicted zone exactly matches the shot's zone | +5 |
| Shot Predictor | Predicted zone adjacent to the shot's zone | +2 |
| Shot Predictor | The scored shot was on target | +2 |
| Shot Predictor | The scored shot was a goal | +5 |
| Player to Watch | Stat score AND crowd rating both beat the position average | +8 |
| Player to Watch | Your pick is the match MVP | +4 |
| Versus Mode | Your pick wins the duel (stat score only) | +3 |

**Mechanic maximums:** Lineup 16 · Sub 10 · Shot 12 · Watch 12 · Versus 3.

### 1. Lineup Predictor

+1 per correctly named starting player (max 11), +5 if the predicted formation exactly matches the actual formation (either side's recorded shape — picks don't carry a side). Max **16**.

### 2. Sub Predictor

One submission per match covering the whole expected sub board. Per predicted pair: +1 for the player subbed off, +1 more for their replacement — the +1 "on" point pays only when the **same actual substitution event** contained both players. Max **10** (5 fully correct pairs).

### 3. Shot Predictor (6-zone grid)

One player, one zone on the 6-zone pitch grid. Zones are left/center/right × inside/outside the box:

| Zone id | Meaning |
|---|---|
| `inside_left` | Inside the box, left third |
| `inside_center` | Inside the box, central third |
| `inside_right` | Inside the box, right third |
| `outside_left` | Outside the box, left third |
| `outside_center` | Outside the box, central third |
| `outside_right` | Outside the box, right third |

**Box geometry** (ESPN `fieldPositionX/Y`, normalized 0–100; X runs goal-to-goal, high X = attacking end): *inside the box* = X ≥ 82 and 21.5 ≤ Y ≤ 78.5 (regulation 16.5 m deep, ~57% of width). Width thirds: Y < 33.3 = left, Y > 66.7 = right, else center. The client renders the same geometry as a 6×4 grid whose cells map to zones (`src/lib/zones.ts` mirrors `server/scoring/shotZones.ts`).

**Zone adjacency map** — "adjacent" means edge-sharing on the 2×3 zone grid, nothing else. Left-inside is adjacent to center-inside and left-outside, **never** to right-anything:

| Predicted zone | Adjacent zones |
|---|---|
| inside_left | inside_center, outside_left |
| inside_center | inside_left, inside_right, outside_center |
| inside_right | inside_center, outside_right |
| outside_left | outside_center, inside_left |
| outside_center | outside_left, outside_right, inside_center |
| outside_right | outside_center, inside_right |

**Scoring one pick:** the picked player's shots are scored one by one as a whole (zone + on-target + goal) and the **single best shot pays** — never stacked per shot:

- Exact zone: **+5** · Adjacent zone: **+2** · Wrong zone: **0**
- The scored shot on target: **+2**
- The scored shot a goal: **+5**
- Max **12** (exact + on target + goal). Player recorded no shots: 0.

**Data caveats (for the agent):** ESPN publishes shot coordinates almost exclusively on *goal* events (and only in some leagues). Therefore: (a) zone points need a *located* shot — goals always qualify; (b) the +2 on-target bonus is awarded **leniently from the stat sheet** whenever the picked player recorded ≥1 shot on target (`match_player_stats.shots_on_target`) even if no located shot exists — in that case the pick scores exactly +2. Shot attribution to the picked player uses event participants; if none match (older sync data), the match's located shots are used as a lenient fallback rather than voiding picks.

### 4. Player to Watch

Base **+8** iff **both** gates pass; **+4** MVP bonus if the pick is the match MVP (highest stat score in the fixture). Max **12**.

| Gate | Threshold |
|---|---|
| Stat gate | Player's post-match stat score **strictly greater** than the match average stat score of their position peers (other players at the same position; falls back to all other featured players when they're the only one at their position) |
| Crowd gate | Player's crowd rating (average of the 3-card ratings) **strictly greater** than the same match crowd average of their position peers (same fallback ladder) |

"Exceeds" is strict: an average exactly equal does not pass.

**Crowd thresholds & sparsity (for the agent):**
- A player's crowd rating counts once it has **≥ 5 votes** (`WATCH_MIN_VOTES`).
- Averages always **exclude the picked player** — a player is measured against their peers, never against an average they're part of (a solo-position player would otherwise never beat their own average).
- The position crowd average uses same-position players meeting the vote floor; if no same-position player has 5 votes, fall back to the **all-position match average** (same floor); if there is no crowd data at all, the crowd gate cannot pass.
- Resolution timing: the stat gate alone can settle the pick early (a failed stat gate = 0, done); a passed stat gate waits for the 24h ratings window; if crowd data is still too sparse **24h after that**, the pick force-settles with whatever the stat gate alone earned (MVP bonus if any; the 8 cannot pay without the crowd verdict).

### 5. Versus Mode

Resolved by **stat score only** (`statScore.ts` output): whichever player has the higher stat score wins the pick. Correct pick **+3**, incorrect **0**, no partial credit. Equal stat scores **void** — nobody gains from a coin flip. The user's pick is `playerA` in the payload.

### 6. Streak bonus

Tracked only against the user's **favorite club** (the anchor chosen first during onboarding — `favorite_teams.is_favorite = 1` — not any of the other followed clubs).

- A favorite-club match is a **hit** if the user made at least one prediction (any of the 5 mechanics) on that match and it scored above 0 points.
- A match with zero hits across all mechanics — **including making no predictions at all** — is a **miss** and resets the streak to 0.
- Consecutive hits build the streak; thresholds pay **one time each per season** at the moment they're crossed (crossing 4→5 pays the +5; 5→6 pays nothing extra until 10):

| Consecutive hits | Bonus |
|---|---|
| 3 | +2 |
| 5 | +5 |
| 10 | +10 |

- A match is evaluated **once** per user (`streak_evaluations` UNIQUE), only after all of that user's predictions on it are settled — Player to Watch can land up to ~48h after full time, and a later award must still be able to flip a would-be miss into a hit.
- Streak state persists across the season and resets at the season boundary (§8). State lives in `user_streaks` (current count, season hit count, thresholds paid, last favorite-club match, active flag).
- Streak bonuses feed the **global** board only (they don't belong to any single match's league/club scope).

### 7. No negative scoring

Every mechanic is zero-or-positive. A wrong prediction never subtracts points or creates a penalty. The ledger refuses negative values at write time (`CHECK (points >= 0)` plus an application-level guard); the pure scorers are unit-tested to never return negative points for any input.

### 8. Points ledger & leaderboards

Every award appends one immutable `point_ledger` row (source = `prediction` or `streak_bonus`; prediction awards carry the match). The ledger incrementally maintains `user_point_totals` per scope:

- **Global** — season total across every award (predictions + streak bonuses).
- **Per-league** (`league:<slug>`) — points from predictions on matches in that league. Any prediction on any match counts toward that match's league board automatically; no following requirement.
- **Per-club** (`club:<teamId>`) — points from predictions on matches involving that club; each match feeds **both** clubs' boards.

**Tiebreaker:** level totals rank by whoever reached that total first. Each totals row stores `reached_total_at` — the ledger timestamp of the award that pushed the user to that exact total, written at award time and never recomputed.

**Season boundary:** opens when the first tracked league starts, closes when the last finishes; all three views (and streak state) reset together. Implemented via the season label on every totals/streak row (e.g. `2026-27`).

**The ratings firewall:** the 3-card rating system and comments are cosmetic/social only. No code path from `crowd_ratings` or `timeline_comments` reaches the ledger — only prediction resolutions and streak bonuses append to it. The Player to Watch crowd *gate* reads rating averages but never writes points from them. A test (`tests/predictionScore.test.ts`) pins that ratings produce no ledger rows.

## Notes for implementation

- Store every mechanic's result as a JSON `breakdown` on the `predictions` row (one key per rule that applied, even if 0) so the UI can show a transparent "why did I get X" panel.
- All point math lives in `server/scoring/predictionScore.ts` as pure functions; `server/scoring/ledger.ts` owns the ledger + totals; `server/scoring/streak.ts` owns streak orchestration. Nothing else computes points.
- Zero-point settlements write no ledger row (they'd otherwise corrupt tiebreak timestamps).
- Re-resolution is safe: prediction awards are idempotent per prediction (ledger UNIQUE), streak evaluations per (user, match), threshold bonuses per season.
- These values are config, not schema: if early users find them off, it's a change to this doc + the constants in `predictionScore.ts`, not a migration.
- Cut and do not reintroduce: appearance streaks, captaincy multipliers, budget/pricing, negative points anywhere in the prediction path, private gameweek leagues.
