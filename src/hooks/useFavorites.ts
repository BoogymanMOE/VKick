import { useMemo } from "react";
import { useFavorites as useFavoritesQuery, useFollowedLeagues } from "./useApi";
import { followThenAnchor } from "../lib/favoriteAnchor";
import type { Team } from "../types";

/**
 * The product rule: five clubs (exactly one of them the anchored favorite),
 * plus an OPTIONAL shelf of up to five international sides — "only if they
 * want" them. The buckets match the picker tabs: anything grouped
 * `international` (national teams) counts against the international cap,
 * everything else is a club.
 */
export const MAX_FAVORITES = 5;
export const MAX_INTERNATIONALS = 5;

/** The picker tab national teams live under (mirrors the server's group_key). */
const INTERNATIONAL_GROUP = "international";

function isInternational(team: Team): boolean {
  return team.groupKey === INTERNATIONAL_GROUP;
}

export type FavoriteResult =
  | { ok: true; added: boolean; team: Team }
  | { ok: false; reason: "cap" | "intlCap" | "server"; code?: string };

/**
 * Favorites live on the server; this hook keeps the synchronous-feeling API
 * the screens use (`toggle` with instant cap checks) while persisting through
 * the backend with optimistic updates. The only local rule is the per-bucket
 * cap — a full club shelf never blocks a national-team pick, and vice versa
 * (the server enforces the same split, see server/db/teamGroups.ts).
 */
export function useFavorites() {
  const { teams, anchorId, count, isFavorite, add, remove, setAnchor, loading } = useFavoritesQuery();

  const intlCount = useMemo(() => teams.filter(isInternational).length, [teams]);
  const clubCount = count - intlCount;

  const toggle = (team: Team): FavoriteResult => {
    if (isFavorite(team.id)) {
      remove.mutate(team.id);
      return { ok: true, added: false, team };
    }
    const intl = isInternational(team);
    const full = intl ? intlCount >= MAX_INTERNATIONALS : clubCount >= MAX_FAVORITES;
    if (full) return { ok: false, reason: intl ? "intlCap" : "cap" };
    add.mutate(team.id);
    return { ok: true, added: true, team };
  };

  /**
   * First pick: follow the team, then set it as the anchor — strictly in
   * that order (the anchor endpoint 404s NOT_FOLLOWING before the follow row
   * exists; see src/lib/favoriteAnchor.ts for the race this replaced).
   * Cap checks match `toggle`, so a full shelf still answers here too.
   *
   * Failures are NOT swallowed: each mutation's own onError runs before the
   * mutateAsync promise settles — `add` rolls back the optimistic row and
   * toasts, `setAnchor` toasts — and this catch runs after those handlers
   * have already surfaced the same error to the user.
   */
  const toggleAndAnchor = (team: Team): FavoriteResult => {
    if (isFavorite(team.id)) return { ok: true, added: false, team };
    const intl = isInternational(team);
    const full = intl ? intlCount >= MAX_INTERNATIONALS : clubCount >= MAX_FAVORITES;
    if (full) return { ok: false, reason: intl ? "intlCap" : "cap" };
    void followThenAnchor(
      team.id,
      (id) => add.mutateAsync(id),
      (id) => setAnchor.mutateAsync(id),
    ).catch(() => {
      /* surfaced by the mutations' onError handlers (see doc block) */
    });
    return { ok: true, added: true, team };
  };

  return {
    teams,
    anchorId,
    count,
    clubCount,
    intlCount,
    isFavorite,
    toggle,
    toggleAndAnchor,
    setAnchor,
    loading,
  };
}

export { useFollowedLeagues };
