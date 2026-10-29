/** Build the home and away MatchLineup objects from the lineups payload.
 *  Pure (no setState, no useQuery): takes the raw API data and team ids,
 *  returns { homeLineup, awayLineup } where each has formation, coach,
 *  starters (LineupPlayer[]), and subs (LineupPlayer[] with minutes > 0).
 */
export interface LineupPlayerFromAPI {
  player_id: string | number;
  full_name: string;
  position: string | null;
  jersey_number: number | null;
  headshot_url: string | null;
  espn_position: string | null;
  formation_place: string | null;
  started: number;
  minutes_played: number | null;
  avatarUrl?: string | null;
  team_id: string | number;
}

export interface LineupSide {
  formation: string;
  coach: string;
  starters: LineupPlayer[];
  subs: LineupPlayer[];
}

export interface LineupPlayer {
  id: string;
  name: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  number: number;
  avatarUrl?: string | null;
  espnPosition: string | null;
  formationPlace: string | null;
  starter: boolean;
  minutes: number;
}

/** Map a single player row from the API to a LineupPlayer shape. */
const toPlayer = (r: LineupPlayerFromAPI): LineupPlayer => {
  const avatarUrl = r.avatarUrl ?? r.headshot_url ?? null;
  return {
    id: String(r.player_id),
    name: String(r.full_name),
    position: (r.position ?? "MID") as "GK" | "DEF" | "MID" | "FWD",
    number: typeof r.jersey_number === "number" ? r.jersey_number : 0,
    espnPosition: typeof r.espn_position === "string" ? r.espn_position : null,
    formationPlace: typeof r.formation_place === "string" ? r.formation_place : null,
    starter: r.started === 1,
    minutes: r.minutes_played ?? 0,
    avatarUrl,
  };
}

export function buildMatchLineups(
  data: { players: LineupPlayerFromAPI[]; home: { formation: string | null }; away: { formation: string | null } },
  homeId: string,
  awayId: string
) {
  const sidePlayers = (teamId: string) =>
    data.players.filter((p) => String(p.team_id) === teamId).map(toPlayer);

  const homeAll = sidePlayers(homeId);
  const awayAll = sidePlayers(awayId);

  const homeLineup = {
    formation: data.home.formation ?? "—",
    coach: "",
    starters: homeAll.filter((p) => p.starter),
    subs: homeAll.filter((p) => !p.starter && p.minutes > 0),
  };

  const awayLineup = {
    formation: data.away.formation ?? "—",
    coach: "",
    starters: awayAll.filter((p) => p.starter),
    subs: awayAll.filter((p) => !p.starter && p.minutes > 0),
  };

  return { homeLineup, awayLineup };
}
