/**
 * SQLite schema — mirrors `data-model.md` plus the `predictions` tables from
 * `prediction-mechanics.md`. The types are written so a later move to Postgres
 * is a translation exercise, not a redesign (INTEGER PK ~ serial, TEXT ISO
 * timestamps ~ datetime, TEXT JSON ~ jsonb).
 *
 * ESPN string ids are stored as TEXT; all timestamps are UTC ISO strings.
 */
import type { DatabaseSync } from "node:sqlite";
import { COMPETITIONS, isCup } from "../espn/types.js";
import { EXTRA_COMPETITIONS } from "../espn/extra.js";

export function migrate(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS teams (
      id            TEXT PRIMARY KEY,          -- ESPN team id
      name          TEXT NOT NULL,
      short_name    TEXT,
      abbreviation  TEXT,
      logo_url      TEXT,
      color         TEXT,
      league        TEXT NOT NULL              -- eng.1 / esp.1 / ita.1 / ger.1 / fra.1
    );
    CREATE INDEX IF NOT EXISTS idx_teams_league ON teams(league);

    CREATE TABLE IF NOT EXISTS players (
      id            TEXT PRIMARY KEY,          -- ESPN athlete id
      team_id       TEXT REFERENCES teams(id),
      full_name     TEXT NOT NULL,
      short_name    TEXT,
      position      TEXT,                      -- GK / DEF / MID / FWD (normalized)
      espn_position TEXT,                      -- raw ESPN abbreviation, e.g. CD-L
      jersey_number INTEGER,
      headshot_url  TEXT,
      active        INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_players_team ON players(team_id);

    CREATE TABLE IF NOT EXISTS gameweeks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      league      TEXT NOT NULL,
      season      TEXT NOT NULL,               -- e.g. 2026-27
      number      INTEGER NOT NULL,            -- matchday number
      deadline_at TEXT NOT NULL,               -- prediction lock time (ISO)
      UNIQUE(league, season, number)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id              TEXT PRIMARY KEY,        -- ESPN event id
      gameweek_id     INTEGER REFERENCES gameweeks(id),
      league          TEXT NOT NULL,
      home_team_id    TEXT NOT NULL REFERENCES teams(id),
      away_team_id    TEXT NOT NULL REFERENCES teams(id),
      kickoff_at      TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'scheduled',  -- scheduled / live / finished
      home_score      INTEGER,
      away_score      INTEGER,
      minute_display  TEXT,                    -- e.g. 90'+3' while live
      round           TEXT,                    -- cup round label ("Quarter-final"); null for leagues
      home_formation  TEXT,
      away_formation  TEXT,
      espn_season     TEXT,
      last_synced_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_matches_league_kickoff ON matches(league, kickoff_at);
    CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);

    CREATE TABLE IF NOT EXISTS match_player_stats (
      match_id        TEXT NOT NULL REFERENCES matches(id),
      player_id       TEXT NOT NULL REFERENCES players(id),
      team_id         TEXT NOT NULL REFERENCES teams(id),
      started         INTEGER NOT NULL DEFAULT 0,
      subbed_in       INTEGER NOT NULL DEFAULT 0,
      subbed_out      INTEGER NOT NULL DEFAULT 0,
      formation_place TEXT,
      minutes_played  INTEGER,
      goals           INTEGER NOT NULL DEFAULT 0,
      assists         INTEGER NOT NULL DEFAULT 0,
      shots           INTEGER NOT NULL DEFAULT 0,
      shots_on_target INTEGER NOT NULL DEFAULT 0,
      yellow_cards    INTEGER NOT NULL DEFAULT 0,
      red_cards       INTEGER NOT NULL DEFAULT 0,
      saves           INTEGER,
      goals_conceded  INTEGER,
      fouls_committed INTEGER NOT NULL DEFAULT 0,
      offsides        INTEGER NOT NULL DEFAULT 0,
      own_goals       INTEGER NOT NULL DEFAULT 0,
      stat_score      INTEGER,                 -- display-only, from scoring-rules.md
      stat_breakdown  TEXT,                    -- JSON of per-rule line items
      PRIMARY KEY (match_id, player_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mps_team ON match_player_stats(team_id);

    CREATE TABLE IF NOT EXISTS timeline_events (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      espn_event_key TEXT,                     -- ESPN keyEvent id when available
      match_id       TEXT NOT NULL REFERENCES matches(id),
      minute_display TEXT NOT NULL,
      minute_seconds INTEGER NOT NULL,
      type           TEXT NOT NULL,            -- goal / card / substitution / var / kickoff / halftime / fulltime / other
      team_id        TEXT REFERENCES teams(id),
      description    TEXT NOT NULL,
      participants   TEXT,                     -- JSON [{id, name}]
      field_x        REAL,                     -- shot origin along the length, 0..100 (ESPN fieldPositionX)
      field_y        REAL,                     -- shot origin across the width, 0..100 (ESPN fieldPositionY)
      goal_y         REAL,                     -- where the ball crossed the line (ESPN goalPositionY)
      UNIQUE(match_id, espn_event_key)
    );
    CREATE INDEX IF NOT EXISTS idx_timeline_match ON timeline_events(match_id, minute_seconds);

    CREATE TABLE IF NOT EXISTS standings (
      league        TEXT NOT NULL,
      season        TEXT NOT NULL,
      team_id       TEXT NOT NULL REFERENCES teams(id),
      rank          INTEGER,
      played        INTEGER,
      wins          INTEGER,
      draws         INTEGER,
      losses        INTEGER,
      goals_for     INTEGER,
      goals_against INTEGER,
      points        INTEGER,
      PRIMARY KEY (league, season, team_id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id  TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      -- 'en' | 'fa': the language this user reads the app in, so the bot's
      -- pushes match the UI. The client owns the value (it is a per-device
      -- choice) and syncs it through POST /api/me/language.
      language     TEXT NOT NULL DEFAULT 'en'
    );

    CREATE TABLE IF NOT EXISTS favorite_teams (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      team_id     TEXT NOT NULL REFERENCES teams(id),
      is_favorite INTEGER NOT NULL DEFAULT 0, -- exactly one per user: the anchor club
      created_at  TEXT NOT NULL,
      UNIQUE(user_id, team_id)
    );
    CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorite_teams(user_id);
    -- NOTE: the anchor partial index (idx_favorites_anchor) is created in the
    -- migration block below, AFTER the is_favorite column backfill. It lived
    -- here once and crashed boot on every pre-anchor database (CREATE INDEX
    -- .. WHERE is_favorite fails when the column does not exist yet, aborting
    -- the whole exec before point_ledger and friends were created).

    -- The user's league follow list (max 5, any ESPN-covered league). Drives
    -- the default matchday list and the tables view. Distinct from clubs:
    -- you follow a league even when you follow none of its clubs.
    CREATE TABLE IF NOT EXISTS followed_leagues (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      league     TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, league)
    );
    CREATE INDEX IF NOT EXISTS idx_followed_leagues_user ON followed_leagues(user_id);

    CREATE TABLE IF NOT EXISTS predictions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL REFERENCES users(id),
      match_id        TEXT NOT NULL REFERENCES matches(id),
      mechanic        TEXT NOT NULL,           -- lineup / shot_plot / sub / player_watch / versus
      payload         TEXT NOT NULL,           -- JSON, mechanic-specific
      locked_at       TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',  -- pending / correct / wrong / void / partial
      points_awarded  INTEGER NOT NULL DEFAULT 0,
      breakdown       TEXT,                    -- JSON, why the points are what they are
      resolved_at     TEXT,
      UNIQUE(user_id, match_id, mechanic)
    );
    CREATE INDEX IF NOT EXISTS idx_predictions_user ON predictions(user_id);
    CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id);

    CREATE TABLE IF NOT EXISTS crowd_ratings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      player_id  TEXT NOT NULL REFERENCES players(id),
      match_id   TEXT NOT NULL REFERENCES matches(id),
      rating     INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 10),
      comment    TEXT,                    -- the eye-test rationale on this card
      created_at TEXT NOT NULL,
      UNIQUE(user_id, player_id, match_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ratings_player_match ON crowd_ratings(player_id, match_id);
    -- The 3-cards-per-match rule reads this constantly.
    CREATE INDEX IF NOT EXISTS idx_ratings_user_match ON crowd_ratings(user_id, match_id);

    CREATE TABLE IF NOT EXISTS timeline_comments (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id       INTEGER REFERENCES timeline_events(id),
      match_id       TEXT NOT NULL REFERENCES matches(id),
      minute_display TEXT,
      minute_seconds INTEGER,
      user_id        INTEGER NOT NULL REFERENCES users(id),
      text           TEXT NOT NULL,
      media_link     TEXT,
      created_at     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_match ON timeline_comments(match_id, minute_seconds);

    CREATE TABLE IF NOT EXISTS bot_push_queue (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id  TEXT NOT NULL,
      -- goal / lineup / lock / halftime / ratings. Delivery gates each row
      -- against the matching preference column, so the KIND has to travel with
      -- the message. Pre-column rows default to 'goal' (see the migration).
      kind         TEXT NOT NULL DEFAULT 'goal',
      text         TEXT NOT NULL,
      created_at   TEXT NOT NULL,
      sent_at      TEXT,
      attempts     INTEGER NOT NULL DEFAULT 0,
      failed_at    TEXT
    );

    -- full minute-by-minute commentary feed (from summary commentary[])
    CREATE TABLE IF NOT EXISTS match_commentary (
      match_id       TEXT NOT NULL REFERENCES matches(id),
      sequence       INTEGER NOT NULL,
      minute_display TEXT,
      minute_seconds INTEGER,
      text           TEXT NOT NULL,
      PRIMARY KEY (match_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_commentary_match ON match_commentary(match_id, sequence);

    -- manager/coach per team (from the roster endpoint)
    CREATE TABLE IF NOT EXISTS team_coaches (
      team_id TEXT PRIMARY KEY REFERENCES teams(id),
      name    TEXT NOT NULL
    );

    -- competition display labels (seeded at migration; slug = ESPN league code)
    CREATE TABLE IF NOT EXISTS competitions (
      slug      TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      kind      TEXT NOT NULL,               -- league / cup
      has_table INTEGER NOT NULL DEFAULT 1  -- 0 for knockout competitions
    );

    -- bookkeeping so goal notifications fire exactly once per goal
    CREATE TABLE IF NOT EXISTS notified_goals (
      match_id       TEXT NOT NULL,
      espn_event_key TEXT NOT NULL,
      notified_at    TEXT NOT NULL,
      PRIMARY KEY (match_id, espn_event_key)
    );

    -- Matchday pushes already sent, one row per (user, match, stage). The
    -- per-minute sweep re-reads the same matches over and over, so the claim is
    -- what stops "kickoff in 40 minutes" arriving forty times. It doubles as
    -- the audit trail of who was told what, when — the rows are tiny (4 per
    -- user per match) and deliberately never pruned.
    CREATE TABLE IF NOT EXISTS match_notifications (
      telegram_id TEXT NOT NULL,
      match_id    TEXT NOT NULL,
      stage       TEXT NOT NULL,
      notified_at TEXT NOT NULL,
      PRIMARY KEY (telegram_id, match_id, stage)
    );

    -- username accounts. Telegram accounts have no row here, so they simply
    -- cannot sign in by username. Usernames are case-insensitive (NOCASE
    -- unique): "Striker10" and "striker10" are the same account, while the
    -- stored casing is kept for display (leaderboards show it as typed).
    -- password_hash holds the scrypt hash (random per-user salt, params baked
    -- in — see server/auth/password.ts), never plaintext. recovery_* remain
    -- unused; no recovery channel exists yet.
    CREATE TABLE IF NOT EXISTS user_credentials (
      user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      username      TEXT COLLATE NOCASE UNIQUE NOT NULL,
      password_hash TEXT,
      recovery_hash TEXT,
      recovery_note TEXT,
      created_at    TEXT NOT NULL
    );

    -- Bearer tokens issued by /api/auth/login (and Telegram sessions). One row
    -- per signed-in client; logout deletes the row, invalidating the token.
    CREATE TABLE IF NOT EXISTS user_sessions (
      token         TEXT PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at    TEXT NOT NULL,
      last_used_at  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);

    -- The curated versus_pairs table was REMOVED: Versus Mode's shipped
    -- mechanic is the user-chosen pair in the prediction payload
    -- (prediction-mechanics.md). Existing databases drop it in the migration
    -- block below; fresh ones never create it.

    -- per-match team-level stats (from summary boxscore.teams[].statistics[])
    CREATE TABLE IF NOT EXISTS match_team_stats (
      match_id          TEXT NOT NULL REFERENCES matches(id),
      team_id           TEXT NOT NULL REFERENCES teams(id),
      possession_pct    REAL,
      shots             INTEGER,
      shots_on_target   INTEGER,
      corners           INTEGER,
      fouls             INTEGER,
      offsides          INTEGER,
      saves             INTEGER,
      passes_total      INTEGER,
      passes_accurate   INTEGER,
      pass_accuracy_pct REAL,
      PRIMARY KEY (match_id, team_id)
    );

    -- Understat per-match xG/xGA, one row per (match, club). ESPN publishes no
    -- expected goals, so this is the only source for the replay pitch's xG
    -- read. Rows are matched from the league payload's per-match history by
    -- club + kickoff date + scoreline, never guessed (see matchResultsToMatches).
    CREATE TABLE IF NOT EXISTS match_understat_stats (
      match_id      TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
      team_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      xg            REAL,
      xga           REAL,
      last_synced_at INTEGER NOT NULL,
      PRIMARY KEY (match_id, team_id)
    );
    CREATE INDEX IF NOT EXISTS idx_mus_match ON match_understat_stats(match_id);

    -- season player leaderboard cache (recomputed after syncs; see teamStats.ts)
    CREATE TABLE IF NOT EXISTS player_season_stats (
      league          TEXT NOT NULL,
      season          TEXT NOT NULL,
      player_id       TEXT NOT NULL REFERENCES players(id),
      team_id         TEXT NOT NULL REFERENCES teams(id),
      appearances     INTEGER NOT NULL DEFAULT 0,
      starts          INTEGER NOT NULL DEFAULT 0,
      minutes         INTEGER NOT NULL DEFAULT 0,
      goals           INTEGER NOT NULL DEFAULT 0,
      assists         INTEGER NOT NULL DEFAULT 0,
      shots           INTEGER NOT NULL DEFAULT 0,
      shots_on_target INTEGER NOT NULL DEFAULT 0,
      yellow_cards    INTEGER NOT NULL DEFAULT 0,
      red_cards       INTEGER NOT NULL DEFAULT 0,
      saves           INTEGER NOT NULL DEFAULT 0,
      goals_conceded  INTEGER NOT NULL DEFAULT 0,
      fouls_committed INTEGER NOT NULL DEFAULT 0,
      own_goals       INTEGER NOT NULL DEFAULT 0,
      stat_score_total INTEGER NOT NULL DEFAULT 0,
      stat_score_avg  REAL NOT NULL DEFAULT 0,
      updated_at      TEXT NOT NULL,
      PRIMARY KEY (league, season, player_id)
    );
    CREATE INDEX IF NOT EXISTS idx_pss_league_goals ON player_season_stats(league, season, goals DESC);
    CREATE INDEX IF NOT EXISTS idx_pss_league_assists ON player_season_stats(league, season, assists DESC);
    CREATE INDEX IF NOT EXISTS idx_pss_team ON player_season_stats(team_id);

    -- season team stats table (per-league W/D/L, goals, possession, etc.)
    CREATE TABLE IF NOT EXISTS team_season_stats (
      league               TEXT NOT NULL,
      season               TEXT NOT NULL,
      team_id              TEXT NOT NULL REFERENCES teams(id),
      played               INTEGER NOT NULL DEFAULT 0,
      wins                 INTEGER NOT NULL DEFAULT 0,
      draws                INTEGER NOT NULL DEFAULT 0,
      losses               INTEGER NOT NULL DEFAULT 0,
      goals_for            INTEGER NOT NULL DEFAULT 0,
      goals_against        INTEGER NOT NULL DEFAULT 0,
      clean_sheets         INTEGER NOT NULL DEFAULT 0,
      avg_possession       REAL NOT NULL DEFAULT 0,
      avg_pass_accuracy    REAL NOT NULL DEFAULT 0,
      total_shots          INTEGER NOT NULL DEFAULT 0,
      total_shots_on_target INTEGER NOT NULL DEFAULT 0,
      total_corners        INTEGER NOT NULL DEFAULT 0,
      total_fouls          INTEGER NOT NULL DEFAULT 0,
      updated_at           TEXT NOT NULL,
      PRIMARY KEY (league, season, team_id)
    );

    -- Understat: per-player season xG/xA (weekly refresh)
    CREATE TABLE IF NOT EXISTS player_understat_stats (
      player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      understat_id  INTEGER,
      season        INTEGER NOT NULL,
      team_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      league        TEXT NOT NULL,
      apps          INTEGER,
      minutes       INTEGER,
      goals         INTEGER,
      assists       INTEGER,
      sh90          REAL,
      kp90          REAL,
      xg            REAL,
      xa            REAL,
      xg90          REAL,
      xa90          REAL,
      last_synced_at INTEGER NOT NULL,
      PRIMARY KEY (player_id, season)
    );
    CREATE INDEX IF NOT EXISTS idx_pus_team ON player_understat_stats(team_id, season);

    -- Understat: per-team season aggregates
    CREATE TABLE IF NOT EXISTS team_understat_stats (
      team_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      season        INTEGER NOT NULL,
      league        TEXT NOT NULL,
      xg            REAL,
      xga           REAL,
      xg_for_total  REAL,
      xg_against_total REAL,
      -- Season sums from the same Understat history walk: expected points
      -- (xPts) is what the table "should" read, and the delta against real
      -- points is the over/under-performance read the xG panel headlines.
      xpts          REAL,
      -- Passes allowed per defensive action, ratio-weighted across matches
      -- (Understat gives att/def per match, not a ratio). Lower = pressing.
      ppda          REAL,
      -- Completed passes into the final 20m, summed over the season.
      deep          INTEGER,
      last_synced_at INTEGER NOT NULL,
      PRIMARY KEY (team_id, season)
    );

    -- Understat: shot situations (5 rows per team per season — always 5)
    CREATE TABLE IF NOT EXISTS team_shot_situations (
      team_id    TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      season     INTEGER NOT NULL,
      situation  TEXT NOT NULL,
      shots      INTEGER,
      goals      INTEGER,
      shots_against   INTEGER,
      goals_against   INTEGER,
      xg         REAL,
      xga        REAL,
      last_synced_at INTEGER NOT NULL,
      PRIMARY KEY (team_id, season, situation)
    );

    -- The points ledger (scoring-rules.md "Points ledger"): one row per
    -- points-awarding event, APPEND-ONLY — points are never updated in place.
    -- This is what makes the tiebreak exact (who reached a total first) and
    -- ratings/comments provably outside the points system: only prediction
    -- and streak awards insert here, nothing else ever does.
    CREATE TABLE IF NOT EXISTS point_ledger (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL REFERENCES users(id),
      match_id      TEXT,                    -- NULL for streak bonuses
      source        TEXT NOT NULL,           -- prediction / streak_bonus
      mechanic      TEXT,                    -- the 5 mechanics when source = prediction
      points        INTEGER NOT NULL CHECK (points >= 0),  -- §7: no negative scoring
      scope_season  TEXT NOT NULL,           -- season label, e.g. "2026-27"
      awarded_at    TEXT NOT NULL,           -- monotonic-ish arrival order (ISO)
      source_id     INTEGER NOT NULL,        -- predictions.id, or the streak_evaluations row
      -- Idempotency guard for re-resolution. NOTE: the column definition must
      -- come BEFORE this table constraint — SQLite rejects a UNIQUE referencing
      -- a column declared later (fresh-DB boot crashed on this once already).
      UNIQUE(source, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_user_season ON point_ledger(user_id, scope_season);
    CREATE INDEX IF NOT EXISTS idx_ledger_match ON point_ledger(match_id) WHERE match_id IS NOT NULL;

    -- Season point totals per user per scope, maintained incrementally on
    -- every ledger insert (leaderboards read ONLY this — no aggregation SQL).
    -- reached_total_at = the ledger timestamp of the award that pushed the
    -- user to this exact total; that's the tiebreak, recorded at award time
    -- per scoring-rules.md, never recomputed after the fact.
    CREATE TABLE IF NOT EXISTS user_point_totals (
      user_id          INTEGER NOT NULL REFERENCES users(id),
      scope            TEXT NOT NULL,        -- global / league:<slug> / club:<teamId>
      scope_season     TEXT NOT NULL,
      total            INTEGER NOT NULL DEFAULT 0,
      reached_total_at TEXT NOT NULL,        -- ties: earlier wins
      PRIMARY KEY (user_id, scope, scope_season)
    );
    CREATE INDEX IF NOT EXISTS idx_totals_board ON user_point_totals(scope, scope_season, total DESC, reached_total_at);

    -- Streak state per user (scoring-rules.md §6): tracked against the
    -- favorite club only. current resets on a miss; seasonHits counts every
    -- hit this season so thresholds pay exactly once; thresholds_paid is the
    -- dedupe ledger of bonuses already awarded (re-resolution is a no-op).
    CREATE TABLE IF NOT EXISTS user_streaks (
      user_id          INTEGER PRIMARY KEY REFERENCES users(id),
      current          INTEGER NOT NULL DEFAULT 0,
      season_hits      INTEGER NOT NULL DEFAULT 0,
      thresholds_paid  TEXT NOT NULL DEFAULT '[]',  -- JSON array of thresholds
      last_match_id    TEXT,                        -- last favorite-club match evaluated
      streak_active    INTEGER NOT NULL DEFAULT 0,
      scope_season     TEXT NOT NULL,
      updated_at       TEXT NOT NULL
    );

    -- One row per (user, favorite-club match) evaluated, whatever the
    -- outcome — hit, miss, or "no predictions at all". The audit trail for
    -- the state machine and the idempotency guard for re-resolution.
    CREATE TABLE IF NOT EXISTS streak_evaluations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      match_id   TEXT NOT NULL REFERENCES matches(id),
      hit        INTEGER NOT NULL,             -- 1 = any mechanic scored > 0
      bonus      INTEGER NOT NULL DEFAULT 0,   -- threshold bonus paid by THIS row
      evaluated_at TEXT NOT NULL,
      UNIQUE(user_id, match_id)
    );

    -- Server-side push preferences (the Profile toggles, enforced). The bot's
    -- push drain checks this table BEFORE sending, so a user who turns off
    -- goal alerts actually stops receiving them. Absent row = all on.
    -- Opt-out: no row at all means everything is on, which is why every read
    -- tolerates a NULL prefs row. The switch that owns each push kind is mapped
    -- in server/notifications.ts (PREF_COLUMN) — keep the two in step.
    CREATE TABLE IF NOT EXISTS user_notification_prefs (
      user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      goals       INTEGER NOT NULL DEFAULT 1,   -- club goal alerts
      deadline    INTEGER NOT NULL DEFAULT 1,   -- lineup drop / kickoff + half-time lock reminders
      ratings     INTEGER NOT NULL DEFAULT 1,   -- rating-window opens
      updated_at  TEXT NOT NULL
    );
  `);

  // The replay-pitch columns were added after v1 of this schema; fresh DBs
  // already have them via CREATE TABLE, older ones get them here.
  // (SQLite has no ADD COLUMN IF NOT EXISTS, hence the pragma check.)
  for (const col of ["field_x", "field_y", "goal_y"]) {
    const existing = db
      .prepare("SELECT name FROM pragma_table_info('timeline_events') WHERE name = ?")
      .get(col);
    if (!existing) {
      db.exec(`ALTER TABLE timeline_events ADD COLUMN ${col} REAL;`);
    }
  }

  // The xG panel's expected-points and pressing columns arrived after the
  // Understat tables shipped; fresh DBs get them via CREATE TABLE, older ones
  // here. (SQLite has no ADD COLUMN IF NOT EXISTS, hence the pragma check.)
  for (const [col, type] of [
    ["xpts", "REAL"],
    ["ppda", "REAL"],
    ["deep", "INTEGER"],
  ] as const) {
    const existing = db
      .prepare("SELECT name FROM pragma_table_info('team_understat_stats') WHERE name = ?")
      .get(col);
    if (!existing) {
      db.exec(`ALTER TABLE team_understat_stats ADD COLUMN ${col} ${type};`);
    }
  }

  // Cup round labels arrived with the Cups round-grouping view; fresh DBs get
  // the column via CREATE TABLE, older ones here. Nullable: league matches
  // have no round, and the client falls back to status sections when empty.
  const matchCols = db.prepare("SELECT name FROM pragma_table_info('matches')").all() as Array<{
    name: string;
  }>;
  if (!matchCols.some((c) => c.name === "round")) {
    db.exec(`ALTER TABLE matches ADD COLUMN round TEXT;`);
  }

  // Recovery-code columns were added after the credentials table shipped;
  // fresh DBs get them via CREATE TABLE, older ones here. (SQLite has no
  // ADD COLUMN IF NOT EXISTS, hence the pragma checks.)
  const credCols = db.prepare("SELECT name FROM pragma_table_info('user_credentials')").all() as Array<{
    name: string;
  }>;
  for (const col of ["recovery_hash", "recovery_note"]) {
    if (!credCols.some((c) => c.name === col)) {
      db.exec(`ALTER TABLE user_credentials ADD COLUMN ${col} TEXT;`);
    }
  }

  // v1 declared password_hash NOT NULL for a removed password flow, then
  // username-only sign-in stored NULL. Passwords are back (scrypt hashes), so
  // the column stays nullable for older NULL rows. Usernames also became case-insensitive (NOCASE
  // unique) after v1, so "Striker10" and "striker10" cannot split into two
  // accounts. SQLite can't ALTER a column's nullability or collation in
  // place, so rebuild the table once (identical layout, nullable
  // password_hash, NOCASE username) and copy every existing row across.
  // Pre-check found zero case-colliding usernames in the wild; if any ever
  // appear, the earliest row keeps the name and the later duplicates lose
  // their credential row (their users row and its data are untouched).
  const pwCol = db
    .prepare(`SELECT "notnull" AS nn FROM pragma_table_info('user_credentials') WHERE name = 'password_hash'`)
    .get() as { nn?: number } | undefined;
  const credSql =
    (
      db.prepare("SELECT sql FROM sqlite_master WHERE name = 'user_credentials'").get() as
        { sql?: string } | undefined
    )?.sql ?? "";
  const needsNocase = !/collate\s+nocase/i.test(credSql);
  if (pwCol?.nn || needsNocase) {
    const dupes = db
      .prepare(
        "SELECT COUNT(*) AS n FROM user_credentials WHERE user_id NOT IN (SELECT MIN(user_id) FROM user_credentials GROUP BY lower(username))",
      )
      .get() as { n: number } | undefined;
    const dupeCount = dupes?.n ?? 0;
    if (dupeCount > 0) {
      console.warn(
        `[migrate] dropping ${dupeCount} case-duplicate credential row(s), earliest keeps the name`,
      );
      db.exec(
        "DELETE FROM user_credentials WHERE user_id NOT IN (SELECT MIN(user_id) FROM user_credentials GROUP BY lower(username))",
      );
    }
    db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE user_credentials_v2 (
        user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        username      TEXT COLLATE NOCASE UNIQUE NOT NULL,
        password_hash TEXT,
        recovery_hash TEXT,
        recovery_note TEXT,
        created_at    TEXT NOT NULL
      );
      INSERT INTO user_credentials_v2 (user_id, username, password_hash, recovery_hash, recovery_note, created_at)
        SELECT user_id, username, password_hash, recovery_hash, recovery_note, created_at FROM user_credentials;
      DROP TABLE user_credentials;
      ALTER TABLE user_credentials_v2 RENAME TO user_credentials;
      PRAGMA foreign_keys = ON;
    `);
  }

  // bot_push_queue gained retry bookkeeping after v1; older DBs get the
  // columns here (SQLite has no ADD COLUMN IF NOT EXISTS).
  const pushCols = db.prepare("SELECT name FROM pragma_table_info('bot_push_queue')").all() as Array<{
    name: string;
  }>;
  for (const col of ["attempts", "failed_at"]) {
    if (!pushCols.some((c) => c.name === col)) {
      db.exec(
        `ALTER TABLE bot_push_queue ADD COLUMN ${col} ${col === "attempts" ? "INTEGER NOT NULL DEFAULT 0" : "TEXT"};`,
      );
    }
  }
  // `kind` arrived with the matchday pushes. The default is not cosmetic: every
  // row queued before this column existed can only have been a goal alert, and
  // the drain needs a kind to know which preference to check it against.
  if (!pushCols.some((c) => c.name === "kind")) {
    db.exec("ALTER TABLE bot_push_queue ADD COLUMN kind TEXT NOT NULL DEFAULT 'goal';");
  }

  // users.language arrived with the localized bot pushes. The default is the
  // whole migration story: every account that predates the column reads
  // English until one of its devices says otherwise.
  const userCols = db.prepare("SELECT name FROM pragma_table_info('users')").all() as Array<{ name: string }>;
  if (!userCols.some((c) => c.name === "language")) {
    db.exec("ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en';");
  }

  // v2 concept: favorite_teams gained the is_favorite anchor flag, and the
  // ratings 3-card system gained the comment column. Fresh DBs get both via
  // CREATE TABLE; older ones here (SQLite has no ADD COLUMN IF NOT EXISTS).
  // Ordering matters: the anchor partial index MUST be created after this
  // backfill (it references is_favorite), never in the main exec above.
  const favCols = db.prepare("SELECT name FROM pragma_table_info('favorite_teams')").all() as Array<{
    name: string;
  }>;
  if (!favCols.some((c) => c.name === "is_favorite")) {
    db.exec("ALTER TABLE favorite_teams ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0;");
  }
  // Pre-index databases never enforced "exactly one anchor", so duplicates are
  // possible — keep the earliest row per user so the UNIQUE index below cannot
  // fail and take down boot the same way the misplaced index once did.
  db.exec(`
    UPDATE favorite_teams SET is_favorite = 0 WHERE is_favorite = 1 AND id NOT IN (
      SELECT MIN(id) FROM favorite_teams WHERE is_favorite = 1 GROUP BY user_id
    );
  `);
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_favorites_anchor ON favorite_teams(user_id) WHERE is_favorite = 1;",
  );
  const ratingCols = db.prepare("SELECT name FROM pragma_table_info('crowd_ratings')").all() as Array<{
    name: string;
  }>;
  if (!ratingCols.some((c) => c.name === "comment")) {
    db.exec("ALTER TABLE crowd_ratings ADD COLUMN comment TEXT;");
  }

  // Streak state gained an explicit season column after v1 of the table so a
  // season rollover can reset it; fresh DBs get it via CREATE TABLE.
  const streakCols = db.prepare("SELECT name FROM pragma_table_info('user_streaks')").all() as Array<{
    name: string;
  }>;
  if (!streakCols.some((c) => c.name === "scope_season")) {
    db.exec("ALTER TABLE user_streaks ADD COLUMN scope_season TEXT NOT NULL DEFAULT '';");
  }

  // versus_pairs removal (curated Versus pairs never shipped as a mechanic —
  // the payload-based path replaced it). Fresh DBs never create the table;
  // existing ones drop it here. IF NOT EXISTS-style guard: DROP IF EXISTS is
  // a no-op on fresh databases.
  db.exec("DROP TABLE IF EXISTS versus_pairs;");

  // Competition labels are code-owned data; seed (never overwrite) on boot.
  const insertCompetition = db.prepare(
    "INSERT OR IGNORE INTO competitions (slug, name, kind, has_table) VALUES (?, ?, ?, ?)",
  );
  for (const c of COMPETITIONS) {
    insertCompetition.run(c.slug, c.name, c.kind, isCup(c.slug) ? 0 : 1);
  }

  // Extra ESPN competitions are browse-only labels (coming soon) until the sync
  // learns their slugs; the name column keeps the English label canonical.
  for (const c of EXTRA_COMPETITIONS) {
    insertCompetition.run(c.slug, c.name, c.kind, 0);
  }
}
