/**
 * Player names for prediction summaries.
 *
 * A prediction payload stores ESPN athlete ids (the only stable join key we
 * have), but nobody should ever READ an id: a summary that says "#44814 v
 * #666357" is unreadable, and it is the only place a raw id used to surface.
 * So the history endpoint resolves those ids to `players.full_name` and ships
 * them alongside — the client localizes them through i18n/names.ts, keeping
 * the same "English data is the source of truth" rule as every other name.
 *
 * One query for the whole page: a history response is up to 100 rows with up
 * to ~11 ids each, so resolving per row would be 100 round trips' worth of
 * work for one list. Ids are collected across all rows, fetched in chunks
 * under SQLite's variable limit, and mapped back.
 *
 * Unknown ids are simply absent from the map — a player who was never synced
 * degrades to the client's "#id" fallback rather than failing the response.
 */
import type { DatabaseSync } from "node:sqlite";
import { all } from "../db/index.js";

/** SQLite's default host-parameter ceiling; stay well under it. */
const ID_CHUNK = 500;

/**
 * The player ids one stored payload references, per mechanic.
 *
 * Deliberately explicit rather than "walk every value that looks like an id":
 * the formation string ("4-3-3") and the grid cell are not players, and a
 * shape-agnostic scan would eventually pick one up and render it as a name.
 */
export function playerIdsForMechanic(mechanic: string, payload: string | null): string[] {
  if (!payload) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const p = parsed as Record<string, unknown>;

  const id = (v: unknown): string | null =>
    typeof v === "string" && /^\d{1,15}$/.test(v) ? v : null;

  switch (mechanic) {
    case "lineup":
      return Array.isArray(p.playerIds) ? p.playerIds.map(id).filter((x): x is string => !!x) : [];
    case "sub": {
      if (!Array.isArray(p.subs)) return [];
      const out: string[] = [];
      for (const pair of p.subs as Array<Record<string, unknown>>) {
        if (!pair || typeof pair !== "object") continue;
        for (const key of ["offId", "onId"]) {
          const v = id(pair[key]);
          if (v) out.push(v);
        }
      }
      return out;
    }
    case "shot_predict":
    case "player_watch": {
      const v = id(p.playerId);
      return v ? [v] : [];
    }
    case "versus": {
      const a = id(p.playerAId);
      const b = id(p.playerBId);
      return [a, b].filter((x): x is string => !!x);
    }
    default:
      return [];
  }
}

/**
 * Add a `player_names` map (id → full_name) to every row that needs one.
 * Mutates and returns the rows; rows whose ids are all unknown get `{}` rather
 * than being dropped, so the client's row count always matches.
 */
export function attachPlayerNames<T extends Record<string, unknown>>(
  db: DatabaseSync,
  rows: T[],
): Array<T & { player_names: Record<string, string> }> {
  const wanted = new Set<string>();
  for (const row of rows) {
    for (const id of playerIdsForMechanic(String(row.mechanic ?? ""), (row.payload as string) ?? null)) {
      wanted.add(id);
    }
  }

  const names = new Map<string, string>();
  const ids = [...wanted];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const slots = chunk.map(() => "?").join(", ");
    for (const p of all<{ id: string; full_name: string }>(
      db,
      `SELECT id, full_name FROM players WHERE id IN (${slots})`,
      [...chunk],
    )) {
      names.set(p.id, p.full_name);
    }
  }

  return rows.map((row) => {
    const ids = playerIdsForMechanic(String(row.mechanic ?? ""), (row.payload as string) ?? null);
    const playerNames: Record<string, string> = {};
    for (const id of ids) {
      const name = names.get(id);
      if (name) playerNames[id] = name;
    }
    return { ...row, player_names: playerNames };
  });
}