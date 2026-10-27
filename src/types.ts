/**
 * View models for the shell. These mirror `data-model.md` closely enough that the
 * real API payloads can slot in later without touching components.
 */

/** "halftime" is a real server status (ESPN HT detection) — not a flavour of live. */
export type MatchStatus = "scheduled" | "live" | "halftime" | "finished";
export type Position = "GK" | "DEF" | "MID" | "FWD";
/** The big five slugs — the picker defaults; any covered league can be followed. */
export type LeagueId = "PL" | "LL" | "SA" | "BL" | "L1";

export interface Team {
  id: string;
  name: string;
  shortName: string;
  abbreviation: string;
  color: string;
  league: LeagueId;
  /**
   * Picker tab this side belongs under, from the server's `group_key`: a
   * big-five LeagueId for domestic clubs, `"international"` for national
   * teams, `"other"` for clubs known only through cup football. Deliberately
   * not `league`, which falls back to PL for every non-big-five side.
   *
   * Optional because it is only served by GET /api/teams: the Team objects
   * built from match payloads have no meaningful group and are never rendered
   * in the picker.
   */
  groupKey?: string;
  /**
   * ESPN CDN crest URL, stored on every team row. Used by TeamBadge only when
   * no crest is bundled under public/logos — the bundled file is preferred
   * because it is normalized to one footprint and needs no network.
   */
  logoUrl?: string | null;
}

export interface Match {
  id: string;
  gameweek: number;
  home: Team;
  away: Team;
  kickoffAt: string;
  /** Real competition slug ("eng.1", "uefa.champions") — the competition label
   *  source. `home.league` is only a big-five alias and says "PL" for cups. */
  league: string;
  status: MatchStatus;
  /**
   * True when the real server status was `halftime`. The adapter folds that
   * into `live` for the feed's sections, so screens that must distinguish a
   * break from a running match read this flag instead of `status`.
   */
  isHalftime?: boolean;
  homeScore: number | null;
  awayScore: number | null;
  minute: string | null;
  /** Icons summarising which prediction mechanics the user has played. */
  predictions: PredictionKind[];
  /** Cup round label from ESPN ("Quarter-final"); null for league matches. */
  round: string | null;
  /** Set briefly when a goal lands, to drive the volt sweep animation. */
  goalFlash?: boolean;
}

export type PredictionKind = "lineup" | "shot" | "sub" | "watch" | "versus";

export type TimelineEventType =
  | "goal"
  | "card"
  | "substitution"
  | "var"
  | "kickoff"
  | "halftime"
  | "fulltime"
  | "other";

export interface TimelineEvent {
  id: string;
  minuteDisplay: string;
  minuteSeconds: number;
  type: TimelineEventType;
  teamId: string | null;
  description: string;
  /** Player names involved, for the event line. */
  participants: string[];
  commentCount: number;
}

export interface PlayerRating {
  playerId: string;
  name: string;
  teamId: string;
  position: Position;
  fantasyPoints: number;
  crowdRating: number | null;
  votes: number;
  myRating: number | null;
  /** The eye-test rationale on this user's card (3-card system). */
  myComment?: string | null;
  /** A recent crowd comment on this player (any user). */
  latestComment?: string | null;
  /** crowd_ratings.id behind latestComment, so it can be reported. */
  latestCommentId?: number | null;
}

export interface SquadPlayer {
  playerId: string;
  name: string;
  teamId: string;
  position: Position;
  price: number;
  points: number;
  starter: boolean;
}

/* ------------------------------------------------------------ match detail */

export interface TeamStats {
  possession: number;
  shots: number;
  shotsOnTarget: number;
  corners: number;
  fouls: number;
  offsides: number;
  saves: number;
  passAccuracy: number;
}

export interface LineupPlayer {
  id: string;
  name: string;
  position: Position;
  number: number;
  /**
   * ESPN's granular role ("CD-L", "AM-R", "LW") where the feed carries it.
   * Drives which side of its line a player stands on; absent for squads the
   * predictor builds by hand, which then fall back to shirt-number order.
   */
  espnPosition?: string | null;
  /**
   * ESPN's 1..11 slot in the published shape — the tiebreaker that orders a
   * line when the feed publishes no granular role. Absent for a predicted XI.
   */
  formationPlace?: string | null;
  /** ESPN headshot URL; missing for some players, so every render falls back
   *  to initials (`PlayerAvatar`). */
  headshot?: string | null;
  /** Set once the sub predictor resolves. */
  subbedOff?: string;
}

/**
 * What one player actually did in this match, read off the timeline and keyed by
 * player id for the lineup pitch. Empty for a fixture that has not been played
 * yet, which is what keeps an upcoming match's lineups looking exactly as they
 * did before the badges existed.
 */
export interface LineupPlayerEvents {
  goals: number;
  assists: number;
  /** Minute this player came off the bench (the sub event's display, "67"). */
  subInMinute?: string;
  /** Minute this player was replaced. */
  subOutMinute?: string;
  /** ESPN folds every sending-off into one type; the description picks the card. */
  card?: "yellow" | "red" | "second-yellow";
}

export interface MatchLineup {
  formation: string;
  coach: string;
  starters: LineupPlayer[];
  subs: LineupPlayer[];
}

/**
 * A pinned timeline comment (server: timeline_comments). `eventId` ties it to
 * a timeline event; a null eventId means a free minute-pin. `isMine` is set
 * by the client from the author id so your own cards render differently.
 */
export interface Comment {
  id: string;
  eventId: string | null;
  matchId: string;
  minuteDisplay: string | null;
  minuteSeconds: number | null;
  author: string;
  authorId: number;
  text: string;
  mediaLink?: string | null;
  isMine?: boolean;
}

/* -------------------------------------------------------- predictions hub */

export type PredictionStatus = "done" | "pending" | "correct" | "wrong" | "open";

export interface PredictionState {
  kind: PredictionKind;
  status: PredictionStatus;
  points: number;
  /** Free-form summary of what the user picked, for the hub row. */
  summary?: string;
}

/** Head-to-head duel presented once per gameweek. */
export interface VersusPair {
  id: string;
  playerA: LineupPlayer;
  playerB: LineupPlayer;
  pointsA: number;
  pointsB: number;
}

export interface LeaderboardRow {
  rank: number;
  manager: string;
  squadName: string;
  squadPoints: number;
  predictionPoints: number;
  isYou?: boolean;
}

/* ------------------------------------------------------------------- news */

/**
 * One ESPN news article, forwarded by the API as-is. `teamIds` are ESPN club
 * ids — the same ones used for matches, rosters and standings — so narrowing
 * the league feed to one club needs no mapping table.
 */
export interface NewsArticle {
  id: string;
  headline: string;
  description: string;
  /** ISO timestamp. */
  published: string;
  byline: string | null;
  imageUrl: string | null;
  /** Full ESPN article URL, opened in a new tab. Null when the feed omits it. */
  webUrl: string | null;
  teamIds: string[];
}

/* ---------------------------------------------------- match detail extras */

/** One previous meeting between two teams, as ESPN's seasonseries reports it. */
export interface H2HEvent {
  id: string;
  date: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  winnerTeamId: string | null;
  status: string;
}

/** H2H summary for a match — the headline line + last 5 meetings. */
export interface MatchH2H {
  summary: string | null;
  seriesLabel: string | null;
  events: H2HEvent[];
}

/** One game in a team's last-5 form. */
export interface FormGame {
  id: string;
  date: string;
  result: "W" | "D" | "L";
  teamId: string;
  opponentId: string;
  teamScore: number | null;
  opponentScore: number | null;
}

/** Both teams' last-5 form for a match. */
export interface MatchForm {
  home: { form: string; games: FormGame[] } | null;
  away: { form: string; games: FormGame[] } | null;
}
