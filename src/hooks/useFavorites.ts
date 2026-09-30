import { useFavorites as useFavoritesQuery, useFollowedLeagues } from "./useApi";
import type { Team } from "../types";

/** The product rule: five clubs, exactly one of them the anchored favorite. */
export const MAX_FAVORITES = 5;

export type FavoriteResult =
  { ok: true; added: boolean; team: Team } | { ok: false; reason: "cap" | "server"; code?: string };

/**
 * Favorites live on the server; this hook keeps the synchronous-feeling API
 * the screens use (`toggle` with instant cap checks) while persisting through
 * the backend with optimistic updates. The only local rule left is the cap —
 * the per-league restriction is gone in the v2 concept.
 */
export function useFavorites() {
  const { teams, anchorId, count, isFavorite, add, remove, setAnchor, loading } = useFavoritesQuery();

  const toggle = (team: Team): FavoriteResult => {
    if (isFavorite(team.id)) {
      remove.mutate(team.id);
      return { ok: true, added: false, team };
    }
    if (count >= MAX_FAVORITES) return { ok: false, reason: "cap" };
    add.mutate(team.id);
    return { ok: true, added: true, team };
  };

  return { teams, anchorId, count, isFavorite, toggle, setAnchor, loading };
}

export { useFollowedLeagues };
