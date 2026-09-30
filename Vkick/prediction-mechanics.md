# Prediction Mechanics

The 5 finalized mechanics as standalone, per-match systems. They were designed to fold into the fantasy engine; the engine was cut, the mechanics stayed — and they now feed the season-long prediction leaderboards (`concept.md`, pillar 2/3). Points are recorded per match on the `predictions` row, shown on the match itself, and **aggregated into the global / per-league / per-club leaderboards**. There is still no squad, no budget and no fantasy ledger.

Merge the tables below into `data-model.md` and `roadmap.md` when implementing.

## Lock & open windows (summary)

| Mechanic | Opens | Locks |
|---|---|---|
| Lineup Predictor | immediately (any time before lock) | **2 hours before kickoff** |
| Sub Predictor | when the official lineup drops | **half-time** (editable until then) |
| Shot Predictor | when the official lineup is confirmed | **kickoff** |
| Player to Watch | when the official lineup is confirmed | **kickoff** |
| Versus Mode | immediately | **kickoff** (no adjusting once the match starts) |

All five are pre-match or first-half mechanics. Nothing is pickable after kickoff except the Sub Predictor's first-half editing window.

## The 5 Mechanics

### 1. Lineup Predictor (pre-match, deep flow)
Predict a match's starting XI + formation before the official lineup is announced (any fixture, not "your team" — there are no teams-of-your-own anymore).
- **Opens:** immediately. **Locks: 2 hours before kickoff** — deliberately earlier than ESPN's official lineup release (~1h before kickoff), so predicting is the skill of reading team news, not a snipe-fest.
- **Scoring (locked, `scoring-rules.md` §1):** each correctly predicted starter **+1**, bonus **+5** if you get the **exact formation** right (e.g. 4-3-3). Max **16** points per match.
- Resolution: ESPN `roster[].starter` + `formationPlace` after lineups are officially released.

### 2. Sub Predictor (first-half window)
One submission per match: predict **all expected substitutions for the match at once** — who comes off, who comes on, for each of the legal substitute slots. This replaces the old live "next sub" mechanic with a single, richer pre/full-first-half call.
- **Opens:** once the official lineup drops. **Stays open and editable until half-time** — users can adjust their board based on how the first half actually plays out. **Locks at half-time.**
- **One submission per match** (continuously editable until lock — no cap-and-void rule anymore).
- **Scoring per predicted sub-pair (locked, `scoring-rules.md` §2):** **+1** for correctly naming the player subbed off, **+1 additional** for correctly naming their replacement — the replacement point pays only when the same actual substitution event contained both players. Max +2 per predicted pair, **+10** per match.
- Resolution: ESPN summary `keyEvents[]` sub events, or `roster[].subbedIn/subbedOut`.

### 3. Shot Predictor (pre-match, single pick)
Pick **one player** and **one location on a pitch grid** where you predict their next shot will come from.
- **Opens:** once the lineup is confirmed. **Locks: kickoff.** One player, one location guess per match.
- **Scoring (locked, `scoring-rules.md` §3):** one of the **6 zones** — left/center/right × inside/outside the box — predicted per picked player. Exact zone **+5**, adjacent zone **+2** (fixed adjacency map in the doc), +2 if the shot was on target, +5 if it was a goal; best single shot pays, max **12**.
- Resolution: `header.competitions[0].details[]` shot/goal events carry `fieldPositionX/Y` for the zone; the on-target bonus falls back to the stat sheet (`match_player_stats.shots_on_target`) since ESPN locates almost only goals.

### 4. Player to Watch (pre-match, one tap)
Pick one player you expect to stand out.
- **Opens:** once the lineup is confirmed. **Locks: kickoff.**
- **Scoring (locked, `scoring-rules.md` §4):** **+8 base** iff the player's post-match stat score **and** their crowd rating both exceed the match average for their position (crowd votes ≥ 5, position average falls back to all positions), plus **+4** if they are named match MVP. Max **12**.
- **MVP definition:** the match MVP is the player with the **highest single-fixture stat score** in that match. If your Player to Watch pick is that player, the bonus applies.
- Resolution: stat score at full time; crowd rating once the rating window closes after the match.
- Tie: ties on the crowd-rating component award all tied pickers (same rule as before).

### 5. Versus Mode (pre-match, quick)
Head-to-head duel, but the user builds the pair: **pick two players from the same match, one from each team**, and predict which of the two has the better performance.
- **Locks: kickoff** — pre-match pick only, no adjusting once the match starts.
- **Scoring (locked, `scoring-rules.md` §5):** correct pick **+3 points**, no partial credit; equal stat scores void.
- **Resolution: stat score only** (`scoring-rules.md`) — no crowd-rating input. That keeps Versus the objective, fast-resolving counterpart to the more subjective, crowd-informed Player to Watch.
- No curated pairs table needed anymore: the pair lives in the prediction's payload, chosen by the user.

## Leaderboards (where the points go)

Every prediction point flows into three boards simultaneously — no following requirement, no opt-in:

- **Global** — the user's full point total across every prediction made all season, regardless of league or club.
- **Per-league** — points from predictions made on matches within that league. Any prediction on any match automatically counts toward that match's league board.
- **Per-club** — points from predictions made on matches involving that club; a match feeds **both** clubs' boards.
- **Tiebreaker:** level scores are ranked by whoever reached that total first (timestamp of reaching the score).
- **Visibility:** public and browsable by anyone — usernames + scores, no gate.
- **Season boundary:** one unified season per year — opens when the first of the user's trackable leagues kicks off, closes when the last one finishes. All leaderboards reset together at that boundary.

Ratings and comments never contribute points, anywhere. That firewall is what keeps the eye test honest.

## Tables (for data-model.md)

### `predictions`
One row per prediction attempt.
| Field | Type | Notes |
|---|---|---|
| id | serial (PK) | |
| user_id | FK -> users.id | |
| match_id | FK -> matches.id | |
| mechanic | enum | lineup / shot_predict / sub / player_watch / versus |
| payload | jsonb | mechanic-specific: XI + formation, player + grid point, sub-pair list, watch pick, versus pair |
| locked_at | datetime | when the prediction was locked (the mechanic's lock time) |
| status | enum | pending / correct / wrong / void |
| points_awarded | int | 0 until resolved; feeds all three leaderboards |
| resolved_at | datetime | nullable |

One row per mechanic per match per user (the Sub Predictor's whole-board submission is one row with the pair list in payload). Resolve per-element and store per-slot results in a jsonb breakdown. The previous `versus_pairs` curated table and `shot_plot_pins` table are gone — the versus pair and the single shot pick both live in `payload`.

### Leaderboard reads
No leaderboard table is required for v1: global = `SUM(points_awarded) GROUP BY user_id`; per-league/per-club join through `matches`. If read volume demands it, cache materialized boards recomputed on resolution — a translation exercise, not a redesign.

## Fairness rules
- Each mechanic has its own lock time (see the window table) — the old single "gameweek deadline" ritual is gone.
- One submission per mechanic per match per user; the Sub Predictor is editable until half-time instead of capped-and-voided.
- No stakes beyond the recorded points: nothing is lost by not playing, and nothing is lost by guessing wrong.
- Tiebreaker-first timestamps must be recorded server-side at award time, not computed after the fact.

## Points display
Points live on the `predictions` row and render on the match: pending while unresolved, correct/wrong after. Unlike the earlier cut, they **also** aggregate into the three leaderboards — that aggregation is the product, not a regression to the fantasy ledger. What stays cut: any per-gameweek private league, any squad-based total, any rating-derived points.

## Roadmap placement
- **Phase 1 (My Teams loop):** Lineup Predictor, Player to Watch, Versus Mode — pre-match; `predictions` table ships with the core schema.
- **Phase 2 (ratings + leaderboards):** wire Player to Watch resolution to the ratings aggregate; ship the three leaderboard boards + tiebreaker.
- **Phase 3 (live/first-half mechanics):** Sub Predictor (lineup-drop → half-time window) and Shot Predictor (needs the pitch grid; adjudication from `details[]` coordinates).

## Open decisions (pick before implementation)
1. ~~Shot Predictor's exact proximity/accuracy formula~~ — **resolved**: the 6-zone grid with exact/adjacent tiers (`scoring-rules.md` §3).
2. ~~Player to Watch: stat-vs-crowd weighting and MVP bonus~~ — **resolved**: 8-base dual-gate + 4 MVP (`scoring-rules.md` §4).
3. Point values are locked per `scoring-rules.md`; changes go through that doc first.
