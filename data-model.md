# Data Model

Reference schema for the Postgres database. Field types are illustrative (Prisma-style); adjust as needed during implementation, but keep the relationships and field intent intact. Concept: `concept.md`. Mechanics and leaderboard rules: `prediction-mechanics.md` + `scoring-rules.md`.

## Core football data (populated from ESPN, via the normalization layer)

### `teams`
| Field | Type | Notes |
|---|---|---|
| id | string (PK) | use ESPN's team id directly, e.g. "382" |
| name | string | e.g. "Manchester City" |
| short_name | string | e.g. "Man City" |
| abbreviation | string | e.g. "MNC" |
| logo_url | string | |
| color | string | hex, for UI theming |
| league | string | any ESPN league slug the sync covers (e.g. `eng.1`, `esp.1`, `uefa.champions`) — not limited to the big five |

### `players`
| Field | Type | Notes |
|---|---|---|
| id | string (PK) | use ESPN's athlete id |
| team_id | FK -> teams.id | current team |
| full_name | string | |
| short_name | string | e.g. "E. Haaland" |
| position | string | GK / DEF / MID / FWD (normalize from ESPN's detailed position abbreviations) |
| jersey_number | int | |
| headshot_url | string | nullable, not all players have one |
| active | boolean | |

### `matches`
| Field | Type | Notes |
|---|---|---|
| id | string (PK) | use ESPN's event id |
| gameweek_id | FK -> gameweeks.id | |
| home_team_id | FK -> teams.id | |
| away_team_id | FK -> teams.id | |
| kickoff_at | datetime | all five prediction locks are computed relative to this (see `prediction-mechanics.md`) |
| status | enum | scheduled / live / finished |
| home_score | int | nullable until match starts |
| away_score | int | nullable until match starts |
| last_synced_at | datetime | when the polling service last updated this row |

### `gameweeks`
Grouping/matchday-numbering only — there is **no gameweek-level prediction deadline** anymore; each mechanic locks relative to its match's kickoff.
| Field | Type | Notes |
|---|---|---|
| id | int (PK) | |
| league | string | a gameweek is per competition — each league has its own numbering |
| season | string | e.g. "2026-27" |
| number | int | matchday number |

### `match_player_stats`
One row per player per match — this is the raw material for the player stat score (`scoring-rules.md`).
| Field | Type | Notes |
|---|---|---|
| id | serial (PK) | |
| match_id | FK -> matches.id | |
| player_id | FK -> players.id | |
| team_id | FK -> teams.id | which side they played for |
| started | boolean | |
| minutes_played | int | derive from sub in/out data if not directly given |
| goals | int | |
| assists | int | |
| shots | int | |
| shots_on_target | int | |
| yellow_cards | int | |
| red_cards | int | |
| saves | int | nullable, goalkeepers only |
| goals_conceded | int | nullable, goalkeepers/defenders |
| fouls_committed | int | |
| own_goals | int | |

### `timeline_events`
Normalized from ESPN's `keyEvents[]`. Read-only match data — there is no user-comment layer on the timeline (pinned minute-comments were cut from the concept).
| Field | Type | Notes |
|---|---|---|
| id | serial (PK) | |
| match_id | FK -> matches.id | |
| minute_display | string | e.g. "57'" |
| minute_seconds | int | raw clock value, for sorting |
| type | string | goal / card / substitution / var / kickoff / halftime / fulltime |
| team_id | FK -> teams.id | nullable |
| description | text | human-readable event text |
| participants | jsonb | player ids/names involved |

## Understat xG data (scraped; separate from the ESPN tables)
ESPN publishes no expected goals, so xG/xGA/xPts come from Understat's league and
team payloads. Everything here is advisory: a club outside Understat's big five,
or a fixture that did not match cleanly, has no row and the UI says "no data".

### `team_understat_stats`
Season aggregates per club (PK `team_id, season`): `xg`, `xga`, `xg_for_total`,
`xg_against_total`, `xpts` (expected points — the "expected table" input),
`ppda`, `deep`, `last_synced_at`. A league-wide walk writes these and leaves
`last_synced_at` untouched on existing rows, because that column is the per-club
scrape's freshness clock.

### `team_shot_situations`
Five rows per club per season (PK `team_id, season, situation`) — shots, goals,
xG and the against side, split by how the chance arrived.

### `player_understat_stats`
Per-player season xG/xA and per-90 rates (PK `player_id, season`).

### `match_understat_stats`
**Per-match** xG, one row per club (PK `match_id, team_id`): `xg`, `xga`,
`last_synced_at`. This is what the replay pitch's expected-goals card reads.
Understat's league history carries no opponent name, so a fixture is paired to
an ESPN match only when side, both goal counts and a within-a-day kickoff agree
with exactly one candidate (`matchResultsToMatches`); ambiguous pairings are
dropped rather than guessed. `xg`/`xga` stay in the club's own perspective.

## App-specific data (owned entirely by us, not from ESPN)

### `users`
| Field | Type | Notes |
|---|---|---|
| id | serial (PK) | |
| telegram_id | string (unique) | primary auth identity |
| username | string (unique) | public handle shown on leaderboards (usernames + scores, no gate) |
| display_name | string | |
| created_at | datetime | |

### `favorite_teams`
The user's supported clubs — the backbone of the product (see `concept.md`). Replaces the cut `fantasy_squads` / `fantasy_squad_players` / `fantasy_points` tables.
| Field | Type | Notes |
|---|---|---|
| id | serial (PK) | |
| user_id | FK -> users.id | |
| team_id | FK -> teams.id | |
| is_favorite | boolean | exactly one per user — the anchor club shown first everywhere |
| created_at | datetime | |
| UNIQUE | (user_id, team_id) | one row per club |

Product rules enforced **in the API**, not only the client: max **5** clubs per user, **no per-league restriction** anymore, exactly **one** flagged `is_favorite`. Return *which* rule failed so the UI can toast the right message; never fail silently.

### `followed_leagues`
The user's league follow list — determines what shows up by default in the matchday list and tables view.
| Field | Type | Notes |
|---|---|---|
| id | serial (PK) | |
| user_id | FK -> users.id | |
| league | string | any ESPN league slug the sync covers |
| created_at | datetime | |
| UNIQUE | (user_id, league) | one row per league |

Max **5** leagues per user, enforced in the API with the same machine-readable-error convention.

### `predictions` summary
The full spec (one row per mechanic per match per user, lock windows, mechanic enum `lineup / shot_predict / sub / player_watch / versus`) lives in `prediction-mechanics.md`. The old `versus_pairs` and `shot_plot_pins` tables are gone — both picks live in the prediction's jsonb `payload`. Prediction points feed the leaderboards through the points ledger below (per-prediction `points_awarded` stays on the row for the match UI).

### Points ledger & leaderboards (scoring-rules.md §8)
Three tables implement the scoring engine's write side (`server/scoring/ledger.ts`):

| Table | Purpose | Notes |
|---|---|---|
| `point_ledger` | append-only award log | one row per points-awarding event; `source` = prediction / streak_bonus, `points >= 0` (no negative scoring), UNIQUE(source, source_id) makes re-resolution idempotent |
| `user_point_totals` | per-user season totals per scope | scope = `global` / `league:<slug>` / `club:<teamId>`; `reached_total_at` = when the user hit this exact total — the leaderboard tiebreak, written at award time |
| `user_streaks` + `streak_evaluations` | favorite-club streak state | current run, season hit count, thresholds paid (JSON), last match, active flag; one evaluation row per (user, favorite-club match) |

Boards are **reads of `user_point_totals` only** — no aggregation SQL at request time. Streak bonuses feed the global scope. Ratings and comments have no path into any of these tables.

### `crowd_ratings`
The 3-card post-match rating: each user rates exactly **3 players of their choice** per match, each with a 1–10 score **plus a comment**. Cosmetic only — never feeds points.
| Field | Type | Notes |
|---|---|---|
| id | serial (PK) | |
| user_id | FK -> users.id | |
| player_id | FK -> players.id | |
| match_id | FK -> matches.id | |
| rating | int | 1-10 |
| comment | text | the eye-test rationale attached to this card |
| created_at | datetime | |
| UNIQUE constraint | (user_id, player_id, match_id) | one rating per user per player per match |

The **3-cards-per-match cap** (any 3 players of the user's choice) is enforced in the API, not by a unique constraint — count the user's rows for that match. Aggregate crowd rating per player = average of submitted scores across all users.

### ~~`timeline_comments`~~ (cut)
Pinned minute-comments were removed from the concept (`concept.md` non-goals). Do not create this table; the timeline renders `timeline_events` only. If social reaction ever returns, it is a product decision to record in `concept.md` first.

## Relationships summary
- A `match` has many `match_player_stats`, `timeline_events`
- A `player` belongs to a `team`, has many `match_player_stats`, `crowd_ratings`
- A `user` has many `favorite_teams` (max 5, one `is_favorite`), `followed_leagues` (max 5), `crowd_ratings` (max 3 per match), `predictions`

## Indexing notes for the agent
- Index `favorite_teams` on `(user_id)` — the hot lookup for the home strip on every app open
- Index `followed_leagues` on `(user_id)` — same hot path for the default matchday list
- Index `match_player_stats` on `(match_id, player_id)` — this is the hot lookup path for both the stat score and rating display
- Index `crowd_ratings` on `(player_id, match_id)` for fast aggregate rating computation
- Index `predictions` on `(user_id, match_id, mechanic)` — uniqueness + "my predictions" lookups
- Index `timeline_events` on `(match_id, minute_seconds)` for ordered timeline rendering
