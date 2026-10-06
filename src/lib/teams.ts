/**
 * The API-row -> app-model adapter for teams.
 *
 * Lives in a pure module (not hooks/useApi) so non-React code and the node test
 * runner can use it without pulling in React, the query client or i18n. Same
 * convention as lib/leagues.ts, which hooks/useApi re-exports to keep its own
 * public surface unchanged.
 */
import { TEAM_FALLBACK } from "./colors";
import { LEAGUE_BY_SLUG } from "./leagues";
import { teamGroupKey } from "./pickerGroups";
import type { ApiTeam } from "./api";
import type { LeagueId, Team } from "../types";

export function teamFromApi(t: ApiTeam): Team {
  return {
    id: t.id,
    name: t.name,
    shortName: t.short_name ?? t.name,
    abbreviation: t.abbreviation ?? "—",
    color: t.color ?? TEAM_FALLBACK,
    // Cup-only teams have no LeagueId; park them in PL for colour/type purposes.
    league: LEAGUE_BY_SLUG[t.league] ?? "PL",
    // ...but the picker must not read them as Premier League clubs, so the tab
    // a side belongs under comes from the server's group_key (see teamGroupKey).
    groupKey: teamGroupKey(t),
    logoUrl: t.logo_url ?? null,
  };
}

export type { LeagueId, Team };
