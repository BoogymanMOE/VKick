# ESPN API Reference (Unofficial)

This is a free, undocumented, no-auth-required API. It is NOT an official ESPN product — treat it as a dependency that could change or break without notice, and always keep the manual-override fallback (see bottom of this doc) wired up.

## Base endpoints (confirmed working)

### Scoreboard — list of matches for a league
```
GET https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard
```
- `eng.1` is the Premier League league code (other league codes exist for La Liga `esp.1`, Bundesliga `ger.1`, Serie A `ita.1`, Ligue 1 `fra.1`, Champions League `uefa.champions`, Europa League `uefa.europa`, and many more — the concept's "up to five leagues, any league ESPN covers" follow list is built on this, so treat new slugs as config, not code)
- Optional query param `?dates=YYYYMMDD` or `?dates=YYYYMMDD-YYYYMMDD` for specific dates/ranges
- Returns an `events[]` array — each event is a match, with:
  - `id` — the event id, needed for the summary endpoint below
  - `date`, `name`, `shortName`
  - `competitions[0].status` — match state (scheduled/in-progress/final)
  - `competitions[0].competitors[]` — home/away teams with scores and basic team stats
  - `competitions[0].details[]` — a lightweight events list (goals/cards) — use the summary endpoint instead for the full version

### Match Summary — full detail for one match
```
GET https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/summary?event={eventId}
```
This is the primary data source for almost everything in the app. Key fields:

**`boxscore.teams[]`** — team-level stats (possession, shots, passes, cards) per side

**`boxscore.teams[].roster[]`** — THE stat-score source. Per player:
- `athlete.id`, `athlete.fullName`, `athlete.shortName`
- `position.abbreviation`
- `starter` (bool), `subbedIn` / `subbedOut` (bool)
- `formationPlace` — position in the formation, for lineup/pitch diagrams
- `stats[]` — array of stat objects, each with `name` (e.g. "totalGoals", "goalAssists", "yellowCards", "saves", "shotsOnTarget") and `value`/`displayValue` — map these directly to `match_player_stats` fields
- `plays[]` — this player's specific moments (goal at X', assist at Y', sub at Z') with `clock.displayValue` and flags like `didScore`, `didAssist`, `substitution`

**`header.competitions[0].details[]`** — goal/card events with `clock`, `team`, `participants[]`, and for goals: `fieldPositionX/Y` and `goalPositionY` (shot location coordinates — usable for a 2D pitch visualization of where goals came from)

**`keyEvents[]`** — the clean, curated event list: kickoff, goals, cards, subs, VAR decisions, halftime, fulltime. Each has `type.text`, `clock.displayValue`, `team`, `participants[]`. **This is the primary source for `timeline_events`** — prefer this over `commentary[]` for the default timeline view since it's pre-filtered to meaningful moments.

**`commentary[]`** — the dense, full minute-by-minute text feed (much larger, includes fouls/corners/every shot). Optional secondary layer for users who want blow-by-blow detail; not required for v1.

**`article.story`** — full prose match recap (HTML-ish string) — optional filler content, not core to any feature.

**`standings`** — live league table, embedded in the same response — useful for a standings screen with no extra API call needed.

**`header.competitions[0].neutralSite`, `.status`** — match state, needed to know whether to poll frequently (live) or rarely (finished/scheduled).

### Team roster — for player database seeding
```
GET https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/{teamId}
```
or the dedicated roster path referenced in team links — use this once per team at season start (and periodically, for transfer windows) to populate the `players` table, rather than relying only on players who've appeared in a match summary.

## Polling strategy

| Situation | Frequency |
|---|---|
| No live matches today | Poll scoreboard once daily |
| Matchday, no kickoffs yet | Poll scoreboard hourly |
| Match live | Poll that match's summary endpoint every 30–60 seconds |
| Match just finished | One final summary pull to lock in final stats, then stop polling that match |

Do not poll more aggressively than this — the endpoint is unofficial and undocumented rate limits are a real risk. A 30–60s interval during live play is enough for a good near-real-time timeline without being aggressive.

## Response quirks to handle in the normalization layer
- Field names are inconsistent in casing/structure between `boxscore.teams[].statistics[]` (team level) and `boxscore.teams[].roster[].stats[]` (player level) — write separate mapping functions for each, don't try to share one parser
- Some fields are absent for players who didn't play (subs not used) — handle nulls gracefully, don't assume every roster entry has full stats
- `clock.displayValue` is a string like `"57'"` or `"90'+3'"` — parse carefully if you need numeric sorting; `clock.value` (seconds) is more reliable for ordering
- Position abbreviations from ESPN (e.g. "CD-L", "AM-R", "RM") are more granular than the GK/DEF/MID/FWD categories the stat score and lineup views need — build a mapping table from ESPN's abbreviations to your four position categories

## Fallback strategy (do not skip)
Since this API has no official support or SLA:
1. The polling service should log and alert (even just a console error visible in your monitoring) whenever a parse fails — a broken field mapping means ESPN changed something
2. Build the admin panel/CLI mentioned in the roadmap's Phase 0 to allow manually patching a match's stats or events if the automatic pull fails for an important match
3. Periodically (e.g. monthly) spot-check a live match's raw response against this doc to catch silent drift before it causes a scoring error
