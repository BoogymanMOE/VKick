/**
 * Club-picker tabs, shared by Onboarding and My Teams.
 *
 * The first five are the big five domestic leagues. The last two are catch-all
 * groups the server computes as `group_key` (see GET /api/teams) and they exist
 * because the picker has to reach sides that belong to no league of their own:
 * cup-only clubs like Ajax, Benfica and Celtic ("other"), and national teams
 * ("international"). Before them the picker filtered on `team.league`, which
 * meant the favorites rule could only ever see the big five — you could watch
 * Benfica in the Champions League and not favorite them.
 *
 * `group_key` is deliberately NOT `Team.league`: `teamFromApi` parks every
 * non-big-five side in "PL" for colour/type purposes, so filtering the picker
 * on `league` would file Ajax under the Premier League.
 *
 * The picker is scoped to those seven tabs. Leagues beyond the big five
 * (Eredivisie, Liga Portugal, …) do NOT get a tab even though the catalog and
 * the sync carry them: the favorites picker is a Top-5 surface, and a team
 * from a lower league can never be favorited through it. Those leagues stay
 * reachable on the league-scoped screens, where `buildLeagueTabs` adds a tab
 * for each one a user follows.
 *
 * Tab keys still match `Team.groupKey` exactly: aliases ("PL") for the big
 * five plus the two catch-alls.
 */
import type { StringKey } from "../i18n/strings";
import type { Team } from "../types";
import { SLUG_BY_LEAGUE, LEAGUE_BY_SLUG } from "./leagues";

const CUP_COMPETITIONS: Array<{ slug: string; name: string }> = [
  { slug: "uefa.champions", name: "UEFA Champions League" },
  { slug: "uefa.europa", name: "UEFA Europa League" },
  { slug: "uefa.europa.conf", name: "UEFA Conference League" },
  { slug: "uefa.super_cup", name: "UEFA Super Cup" },
  { slug: "eng.fa", name: "English FA Cup" },
  { slug: "eng.league_cup", name: "English Carabao Cup" },
  { slug: "esp.copa_del_rey", name: "Spanish Copa del Rey" },
  { slug: "ita.coppa_italia", name: "Coppa Italia" },
  { slug: "ger.dfb_pokal", name: "German Cup" },
  { slug: "fra.coupe_de_france", name: "Coupe de France" },
];

/**
 * The picker tab a cached team row belongs under — the ONE derivation of it.
 *
 * Lives here, beside the group vocabulary, because three places need it and
 * they must not drift: the `Team.groupKey` projection (lib/teams), the
 * favorites optimistic update (lib/optimistic), and the picker's own filtering.
 *
 * A non-empty server `group_key` wins (it already accounts for cup-only clubs
 * and national teams); otherwise fall back to the big-five alias for the team's
 * league, and finally to the "other" catch-all. Big-five slugs collapse to
 * their app alias so tabs and rows agree on the same key.
 */
export function teamGroupKey(team: { group_key?: string | null; league: string }): string {
  return (
    (team.group_key ? (LEAGUE_BY_SLUG[team.group_key] ?? team.group_key) : null) ??
    LEAGUE_BY_SLUG[team.league] ??
    OTHER_GROUP
  );
}

/** Cup-only clubs: known through European/domestic cup football, no league. */
export const OTHER_GROUP = "other";
/** National teams: sides that only ever appear in international tournaments. */
export const INTERNATIONAL_GROUP = "international";

/** The fixed part of the tab list: big-five aliases plus the two catch-alls. */
export const PICKER_GROUPS: ReadonlyArray<{ key: string; label: StringKey }> = [
  { key: "PL", label: "league.PL" },
  { key: "LL", label: "league.LL" },
  { key: "SA", label: "league.SA" },
  { key: "BL", label: "league.BL" },
  { key: "L1", label: "league.L1" },
  { key: OTHER_GROUP, label: "picker.otherClubs" },
  { key: INTERNATIONAL_GROUP, label: "picker.international" },
];

/** A resolved tab: `value` matches Team.groupKey, `label` is display-ready. */
export interface PickerGroup {
  value: string;
  label: string;
}

/**
 * The picker's tab list: the big five (translated aliases) then the two
 * catch-alls. Deliberately independent of the competitions catalog — no league
 * beyond the big five is offered as a favorites tab.
 */
export function buildPickerGroups(t: (key: StringKey) => string): PickerGroup[] {
  return PICKER_GROUPS.map((g) => ({ value: g.key, label: t(g.label) }));
}

/** The sides filed under one picker tab, in the server's sort order. */
export function teamsInGroup(teams: Team[], group: string): Team[] {
  return teams.filter((team) => team.groupKey === group);
}

/** A tab on the league-scoped screens (Table, PlayerStats, Leaderboards). */
export interface LeagueTab {
  /** Alias ("PL") for the big five, slug ("ned.1") beyond them. */
  value: string;
  label: string;
}

/** A followed-league row as /api/me/leagues serves it. */
export interface FollowedLeagueRow {
  league: string;
  name: string | null;
  kind: "league" | "cup" | "tournament" | null;
}

/**
 * Tabs for the league-scoped screens: the big five always (translated
 * aliases), then every FOLLOWED non-cup league beyond them in catalog order.
 * Cups and internationals never get a tab — they have no table to show. A
 * user who follows Eredivisie sees it here and in the picker automatically;
 * a user who follows nobody beyond the big five sees exactly the old five.
 */
export function buildLeagueTabs(
  followed: FollowedLeagueRow[],
  t: (key: StringKey) => string,
  localize: (name: string) => string,
): LeagueTab[] {
  const bigFive = PICKER_GROUPS.filter((g) => g.key !== OTHER_GROUP && g.key !== INTERNATIONAL_GROUP);
  const aliasBySlug = new Map(Object.entries(SLUG_BY_LEAGUE).map(([slug, alias]) => [slug, alias]));
  const extras = followed.filter((row) => row.kind === "league" && !aliasBySlug.has(row.league));
  const seen = new Set<string>();

  const followedCups = followed.filter((row) => row.kind === "cup");
  const catalogCups = CUP_COMPETITIONS.map((c) => ({
    league: c.slug,
    name: c.name,
    kind: "cup" as const,
  }));
  const allCups = [
    ...followedCups,
    ...catalogCups.filter((c) => !followedCups.some((f) => f.league === c.league)),
  ];

  return [
    ...bigFive.map((g) => ({ value: g.key, label: t(g.label) })),
    ...extras
      .filter((row) => (seen.has(row.league) ? false : (seen.add(row.league), true)))
      .map((row) => ({ value: row.league, label: localize(row.name ?? row.league) })),
    ...allCups
      .filter((row) => (seen.has(row.league) ? false : (seen.add(row.league), true)))
      .map((row) => ({ value: row.league, label: localize(row.name ?? row.league) })),
  ];
}
