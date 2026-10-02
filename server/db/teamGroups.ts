import { INTERNATIONALS } from "../espn/types.js";

/**
 * The picker-group vocabulary and the favorites caps, in one place.
 *
 * `group_key` (see GET /api/teams) files every side under a picker tab: a
 * league slug for domestic clubs, `international` for national teams, `other`
 * for clubs known only through cup football. The favorites caps are defined
 * on those same buckets — five clubs, plus an OPTIONAL shelf of up to five
 * international sides for users who want them — so a tap on a tab always hits
 * a rule the user can see: the club shelf filling never blocks a national
 * team pick, and vice versa.
 *
 * TEAM_GROUP_SQL is the single source of the grouping: the favorites
 * endpoints, the guest merge and GET /api/teams all share it, so the cap
 * bucket and the picker tab can never drift apart.
 */

export const INTL_GROUP = "international";
export const OTHER_GROUP = "other";

/** Clubs (domestic leagues + the cup-only "other" shelf), one anchor among them. */
export const MAX_CLUB_FAVORITES = 5;
/** International sides: a separate, optional shelf — only if the user wants them. */
export const MAX_INTERNATIONAL_FAVORITES = 5;

/**
 * SQL CASE for the team alias `t` computing `group_key`, exactly as
 * GET /api/teams serves it: a non-empty league wins, then any side seen in an
 * international-tournament match is a national team, and the rest are
 * cup-only clubs. Bind TEAM_GROUP_PARAMS (the international slugs) before any
 * other placeholder in the same statement.
 */
export const TEAM_GROUP_SQL = `CASE
    WHEN t.league != '' THEN t.league
    WHEN EXISTS (
      SELECT 1 FROM matches m
      WHERE (m.home_team_id = t.id OR m.away_team_id = t.id)
        AND m.league IN (${INTERNATIONALS.map(() => "?").join(", ")})
    ) THEN '${INTL_GROUP}'
    ELSE '${OTHER_GROUP}'
  END`;

/** Bind values for the placeholders inside TEAM_GROUP_SQL, in order. */
export const TEAM_GROUP_PARAMS: string[] = [...INTERNATIONALS];

/** True when a group_key is the international (national-team) bucket. */
export function isInternationalGroup(group: string | null | undefined): boolean {
  return group === INTL_GROUP;
}

/** How many favorites the bucket a group belongs to allows. */
export function favoritesCap(group: string | null | undefined): number {
  return isInternationalGroup(group) ? MAX_INTERNATIONAL_FAVORITES : MAX_CLUB_FAVORITES;
}

/**
 * The machine-readable cap error for adding one more favorite of `newGroup`
 * when `existingGroups` are already followed — or null while a slot is free.
 * Null/unknown groups count as clubs (the defensive default matches the
 * picker, where every non-international tab is a club shelf).
 */
export function favoriteCapError(
  existingGroups: ReadonlyArray<string | null | undefined>,
  newGroup: string | null | undefined,
): string | null {
  const intl = isInternationalGroup(newGroup);
  const used = existingGroups.filter((g) => isInternationalGroup(g) === intl).length;
  if (used < favoritesCap(newGroup)) return null;
  return intl ? "MAX_INTERNATIONALS" : "MAX_CLUBS";
}
