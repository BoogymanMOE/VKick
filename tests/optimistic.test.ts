/**
 * Optimistic cache updates must write the RAW query payload, not the shape
 * `select` projects.
 *
 * This suite drives the real helpers through a real `QueryClient` + subscribed
 * `QueryObserver` — the same machinery a mounted hook uses — because the bug
 * it guards is invisible to a unit test of the helpers alone. Writing the
 * projected shape into the cache makes `select` throw *inside the observer*:
 * React Query catches it, flips the query to `status: "error"` with a
 * TypeError, and silently keeps the previous data. The optimistic row never
 * appears and the screen waits for the round-trip — exactly what the code it
 * replaced claimed to do. Nothing crashes, nothing logs; the feature is just
 * quietly dead, which is why it survived review.
 *
 * So the assertions are about OBSERVABLE state after the write:
 *   - `isError` is false (select could consume the payload), and
 *   - the projected view actually contains the optimistic row.
 */
import { strict as assert } from "node:assert";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  addFavoriteOptimistic,
  favoritesView,
  mergePrefsOptimistic,
  removeFavoriteOptimistic,
  type FavoritesPayload,
  type NotificationPrefsPayload,
} from "../src/lib/optimistic.js";
import type { ApiFavorite, ApiTeam } from "../src/lib/api.js";

function club(id: string, name: string, group_key?: string): ApiTeam {
  return {
    id,
    name,
    short_name: name.slice(0, 3).toUpperCase(),
    abbreviation: name.slice(0, 3).toUpperCase(),
    color: "#123456",
    logo_url: null,
    league: "eng.1",
    group_key,
  };
}

function favorite(t: ApiTeam, is_favorite = 0): ApiFavorite {
  return { ...t, is_favorite, created_at: "2026-01-01T00:00:00.000Z" };
}

/** A subscribed observer over the favorites query, as the hook mounts it. */
function favoritesObserver(payload: FavoritesPayload) {
  const qc = new QueryClient();
  const key = ["favorites"];
  qc.setQueryData(key, payload);
  const observer = new QueryObserver(qc, { queryKey: key, queryFn: () => payload, select: favoritesView });
  const unsubscribe = observer.subscribe(() => {});
  return {
    qc,
    key,
    observer,
    close: unsubscribe,
    write: (next: FavoritesPayload | undefined) => {
      if (next) qc.setQueryData(key, next);
    },
  };
}

function testAddFollows(): void {
  const arsenal = club("359", "Arsenal");
  const chelsea = club("362", "Chelsea");
  const env = favoritesObserver({ favorites: [favorite(arsenal, 1)] });
  try {
    assert.equal(env.observer.getCurrentResult().data?.teams.length, 1, "baseline");

    // Exactly what useFavorites' add.onMutate does.
    env.write(addFavoriteOptimistic(env.qc.getQueryData(["favorites"]), chelsea));

    const r = env.observer.getCurrentResult();
    assert.equal(r.error, null, "select must not throw on the optimistic payload");
    assert.equal(r.isError, false, "the query must not enter an error state");
    assert.equal(r.status, "success");
    assert.equal(r.data?.teams.length, 2, "the optimistic row renders immediately");
    assert.deepEqual(
      r.data?.teams.map((t) => t.id),
      ["359", "362"],
    );
    // The anchor is still Arsenal, not the newcomer.
    assert.equal(r.data?.anchorId, "359", "anchor is unchanged by a plain follow");
  } finally {
    env.close();
  }
}

function testAddIsAPureNoopWhenItShouldBe(): void {
  const arsenal = club("359", "Arsenal");
  const env = favoritesObserver({ favorites: [favorite(arsenal, 1)] });
  try {
    const prev = env.qc.getQueryData(["favorites"]) as FavoritesPayload;
    assert.equal(addFavoriteOptimistic(undefined, club("362", "Chelsea")), undefined, "no cached payload");
    assert.equal(addFavoriteOptimistic(prev, undefined), prev, "team never loaded");
    assert.equal(addFavoriteOptimistic(prev, club("359", "Arsenal")), prev, "already followed");
    assert.equal(env.observer.getCurrentResult().isError, false);
  } finally {
    env.close();
  }
}

function testAddRespectsTheBucketCap(): void {
  // Five clubs already followed: a sixth club must not appear optimistically.
  const full = Array.from({ length: 5 }, (_, i) => favorite(club(String(100 + i), `Club ${i}`)));
  const env = favoritesObserver({ favorites: full });
  try {
    const prev = env.qc.getQueryData(["favorites"]) as FavoritesPayload;
    const next = addFavoriteOptimistic(prev, club("999", "Sixth"));
    assert.equal(next, prev, "a full club bucket returns the payload unchanged");
    env.write(next);
    assert.equal(env.observer.getCurrentResult().data?.teams.length, 5, "club bucket stays at five");
    assert.equal(env.observer.getCurrentResult().isError, false);
  } finally {
    env.close();
  }

  // ...but a national team is a SEPARATE shelf, so it still fits.
  const brazil = club("205", "Brazil", "international");
  const env2 = favoritesObserver({ favorites: full });
  try {
    env2.write(addFavoriteOptimistic(env2.qc.getQueryData(["favorites"]), brazil));
    const r = env2.observer.getCurrentResult();
    assert.equal(r.error, null);
    assert.equal(r.data?.teams.length, 6, "internationals have their own shelf");
  } finally {
    env2.close();
  }
}

function testUnfollow(): void {
  const arsenal = favorite(club("359", "Arsenal"), 1);
  const chelsea = favorite(club("362", "Chelsea"));
  const env = favoritesObserver({ favorites: [arsenal, chelsea] });
  try {
    env.write(removeFavoriteOptimistic(env.qc.getQueryData(["favorites"]), "359"));
    const r = env.observer.getCurrentResult();
    assert.equal(r.error, null);
    assert.deepEqual(
      r.data?.teams.map((t) => t.id),
      ["362"],
      "the unfollowed row disappears immediately",
    );
    assert.equal(r.data?.anchorId, "362", "anchor falls back to the first remaining row");
  } finally {
    env.close();
  }
}

function testNotificationPrefs(): void {
  const qc = new QueryClient();
  const key = ["notification-prefs"];
  const payload: NotificationPrefsPayload = { prefs: { goals: true, deadline: true, ratings: true } };
  qc.setQueryData(key, payload);
  // Exactly useNotificationPrefs' select.
  const observer = new QueryObserver(qc, { queryKey: key, queryFn: () => payload, select: (d) => d.prefs });
  const unsubscribe = observer.subscribe(() => {});
  try {
    const prev = qc.getQueryData<NotificationPrefsPayload>(key);
    qc.setQueryData(key, mergePrefsOptimistic(prev, { goals: false }));

    const r = observer.getCurrentResult();
    assert.equal(r.error, null);
    assert.equal(r.data?.goals, false, "the flipped switch moves immediately");
    assert.equal(r.data?.deadline, true, "untouched switches are preserved");
    assert.deepEqual(
      qc.getQueryData<NotificationPrefsPayload>(key)?.prefs,
      { goals: false, deadline: true, ratings: true },
      "the merge lands INSIDE prefs, not at the top level",
    );
  } finally {
    unsubscribe();
  }
}

export function runOptimisticTests(): void {
  testAddFollows();
  testAddIsAPureNoopWhenItShouldBe();
  testAddRespectsTheBucketCap();
  testUnfollow();
  testNotificationPrefs();
  console.log("  optimistic: raw-shape writes survive select, cap + anchor rules intact OK");
}