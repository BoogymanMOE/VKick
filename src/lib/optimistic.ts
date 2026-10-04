/**
 * Optimistic cache updates, as PURE functions over the RAW query payload.
 *
 * WHY THIS MODULE EXISTS. React Query caches the RAW `queryFn` result and runs
 * `select` on read, per hook. An optimistic update therefore has to write the
 * RAW shape — not the shape `select` projects. Writing the projected shape
 * looks right in the hook (`teams`/`anchorId` are what the UI reads) and is
 * wrong underneath: `select` then runs against a payload that has none of the
 * fields it expects. For favorites that is `data.favorites.map(...)` on
 * `undefined`, which throws inside the observer — the query flips to
 * `status: "error"` carrying a TypeError, the optimistic row never renders,
 * and the screen waits for the network round-trip anyway. For notification
 * prefs nothing throws at all; `data.prefs` still resolves, just to the OLD
 * value, so the toggle silently does not move.
 *
 * Both are invisible in review because the rollback path is genuinely correct
 * (`getQueryData` really does return raw) — only the optimistic write is
 * wrong. Keeping the writes here, next to the projections they must match,
 * makes the pairing checkable; tests/optimistic.test.ts drives them through a
 * real QueryClient so the invariant is enforced rather than remembered.
 */
import type { ApiFavorite, ApiTeam } from "./api";
import { teamFromApi } from "./teams";
import { INTERNATIONAL_GROUP, teamGroupKey } from "./pickerGroups";

/** Raw payload of the `["favorites"]` query (GET /api/me/favorites). */
export interface FavoritesPayload {
  favorites: ApiFavorite[];
}

/**
 * The projection the favorites hook exposes. This IS the query's `select`, and
 * the optimistic helpers below must keep writing a shape it can consume.
 */
export function favoritesView(data: FavoritesPayload): {
  teams: ReturnType<typeof teamFromApi>[];
  anchorId: string | null;
} {
  return {
    teams: data.favorites.map(teamFromApi),
    anchorId: data.favorites.find((f) => f.is_favorite === 1)?.id ?? data.favorites[0]?.id ?? null,
  };
}

/**
 * Per-bucket favorites cap — five clubs and, separately, five national teams.
 * Mirrors server/db/teamGroups.ts; the server is still the authority, this only
 * keeps the optimistic row from appearing for a tap the server will refuse.
 */
const BUCKET_CAP = 5;

/**
 * Optimistic follow. Returns the input unchanged when there is nothing to do
 * (no cached payload, the team was never loaded, already followed, or the
 * bucket is full) so the caller can write unconditionally.
 */
export function addFavoriteOptimistic(
  prev: FavoritesPayload | undefined,
  team: ApiTeam | undefined,
  now: string = new Date().toISOString(),
): FavoritesPayload | undefined {
  if (!prev || !team) return prev;
  if (prev.favorites.some((f) => f.id === team.id)) return prev;
  const intl = teamGroupKey(team) === INTERNATIONAL_GROUP;
  const used = prev.favorites.filter((f) => (teamGroupKey(f) === INTERNATIONAL_GROUP) === intl).length;
  if (used >= BUCKET_CAP) return prev;
  return { favorites: [...prev.favorites, { ...team, is_favorite: 0, created_at: now }] };
}

/** Optimistic unfollow. The anchor re-falls-back inside `favoritesView`. */
export function removeFavoriteOptimistic(
  prev: FavoritesPayload | undefined,
  teamId: string,
): FavoritesPayload | undefined {
  if (!prev) return prev;
  return { favorites: prev.favorites.filter((f) => f.id !== teamId) };
}

/** Raw payload of the `["notification-prefs"]` query. */
export interface NotificationPrefsShape {
  goals: boolean;
  deadline: boolean;
  ratings: boolean;
}
export interface NotificationPrefsPayload {
  prefs: NotificationPrefsShape;
}

/**
 * Optimistic preference flip. The partial is merged INSIDE `prefs` — writing it
 * at the top level is the same shape mistake as above, and here it fails
 * silently rather than loudly.
 */
export function mergePrefsOptimistic(
  prev: NotificationPrefsPayload | undefined,
  partial: Partial<NotificationPrefsShape>,
): NotificationPrefsPayload | undefined {
  if (!prev) return prev;
  return { prefs: { ...prev.prefs, ...partial } };
}