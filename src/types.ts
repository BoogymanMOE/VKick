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
  status: MatchStatus;
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

export type TimelineEventType = "goal" | "card" | "substitution" | "var" | "halftime" | "fulltime";

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
  /** Set once the sub predictor resolves. */
  subbedOff?: string;
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

export interface CommentaryLine {
  id: string;
  minuteDisplay: string;
  text: string;
  isKey?: boolean;
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
