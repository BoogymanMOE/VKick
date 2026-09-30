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
 * Tab keys match `Team.groupKey` exactly: aliases ("PL") for the big five,
 * the raw competition slug ("eng.2", "ned.1"…) for every other league in the
 * catalog, and the two catch-alls. `buildPickerGroups` assembles that list
 * from the live competitions query, so promoting a league in the server
 * catalog adds its tab with no client change.
 */
import type { StringKey } from "../i18n/strings";
import type { Team } from "../types";
import { SLUG_BY_LEAGUE } from "./leagues";

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

/** Minimal competition shape the picker needs (from useCompetitions). */
export interface PickerComp {
  slug: string;
  kind: string;
  name: string;
}

/** A resolved tab: `value` matches Team.groupKey, `label` is display-ready. */
export interface PickerGroup {
  value: string;
  label: string;
}

/**
 * The full tab list for the picker: big five (translated aliases), then every
 * other league competition in the catalog (localized ESPN name), then the
 * catch-alls. Big-five comps are skipped by slug so they never double up.
 */
export function buildPickerGroups(
  comps: PickerComp[],
  t: (key: StringKey) => string,
  localize: (name: string) => string,
): PickerGroup[] {
  const bigFiveSlugs = new Set(Object.values(SLUG_BY_LEAGUE));
  const bigFive = PICKER_GROUPS.filter((g) => g.key !== OTHER_GROUP && g.key !== INTERNATIONAL_GROUP);
  const extras = comps
    .filter((c) => c.kind === "league" && !bigFiveSlugs.has(c.slug))
    .map((c) => ({ value: c.slug, label: localize(c.name) }));
  return [
    ...bigFive.map((g) => ({ value: g.key, label: t(g.label) })),
    ...extras,
    { value: OTHER_GROUP, label: t("picker.otherClubs") },
    { value: INTERNATIONAL_GROUP, label: t("picker.international") },
  ];
}

/** The sides filed under one picker tab, in the server's sort order. */
export function teamsInGroup(teams: Team[], group: string): Team[] {
  return teams.filter((team) => team.groupKey === group);
}
