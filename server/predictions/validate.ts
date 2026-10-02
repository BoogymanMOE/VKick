/**
 * Per-mechanic payload validation for prediction submissions.
 *
 * Every mechanic has a schema here, enforced at submit time; the resolver can
 * rely on it. All validators return a canonical payload object or null (reject).
 *
 * Shapes per `prediction-mechanics.md`:
 *   lineup       — XI + formation, locks 2h before kickoff
 *   sub          — ONE whole-board submission: list of {offId, onId} pairs,
 *                  editable until half-time (replaces the capped live calls)
 *   shot_predict — one player + one grid point (replaces the 2-pin Shot Plotter)
 *   player_watch — one player (stat + crowd components resolve post-match)
 *   versus       — two players from opposite sides, user-chosen pair
 */
import type { ShotPin } from "../scoring/shotGrid.js";

export type Mechanic = "lineup" | "shot_predict" | "sub" | "player_watch" | "versus";

export interface LineupPayload {
  playerIds: string[]; // exactly 11
  formation: string; // e.g. "4-3-3"
}
export interface SubPayload {
  subs: Array<{ offId: string; onId: string }>; // the whole expected sub board
}
export interface ShotPredictPayload {
  playerId: string;
  grid: ShotPin; // single location pick
}
export interface PlayerWatchPayload {
  playerId: string;
}
export interface VersusPayload {
  playerAId: string;
  playerBId: string;
}

export type PredictionPayload =
  LineupPayload | SubPayload | ShotPredictPayload | PlayerWatchPayload | VersusPayload;

const ID_RE = /^[0-9]{1,15}$/; // ESPN athlete ids are numeric strings
const MAX_SUB_PAIRS = 5; // legal substitute slots per side, per the concept

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function allNumericIds(v: unknown, n: number): string[] | null {
  if (!Array.isArray(v) || v.length !== n) return null;
  const out: string[] = [];
  for (const item of v) {
    const s = str(item);
    if (!s || !ID_RE.test(s)) return null;
    out.push(s);
  }
  // Duplicated player ids would double-count lineup points.
  if (new Set(out).size !== out.length) return null;
  return out;
}

/** Formation like "4-3-3" / "4-2-3-1": 3-5 numeric lines summing to 10 outfielders. */
function validFormation(f: string): boolean {
  return /^[1-5](-[1-5]){2,4}$/.test(f) && f.split("-").reduce((a, b) => a + Number(b), 0) === 10;
}

/** Grid point 0..5 across, 0..3 along (attacking end = row 0). */
function validGrid(v: unknown): ShotPin | null {
  if (v === null || typeof v !== "object") return null;
  const gx = (v as Record<string, unknown>).gridX;
  const gy = (v as Record<string, unknown>).gridY;
  if (!Number.isInteger(gx) || !Number.isInteger(gy)) return null;
  if ((gx as number) < 0 || (gx as number) >= 6 || (gy as number) < 0 || (gy as number) >= 4) return null;
  return { id: "pick", gridX: gx as number, gridY: gy as number };
}

export function validatePayload(mechanic: Mechanic, raw: unknown): PredictionPayload | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;

  switch (mechanic) {
    case "lineup": {
      const playerIds = allNumericIds(p.playerIds, 11);
      const formation = str(p.formation);
      if (!playerIds || !formation || !validFormation(formation)) return null;
      return { playerIds, formation };
    }

    case "sub": {
      if (!Array.isArray(p.subs) || p.subs.length < 1 || p.subs.length > MAX_SUB_PAIRS) return null;
      const subs: Array<{ offId: string; onId: string }> = [];
      for (const item of p.subs) {
        if (item === null || typeof item !== "object") return null;
        const offId = str((item as Record<string, unknown>).offId);
        const onId = str((item as Record<string, unknown>).onId);
        if (!offId || !onId || !ID_RE.test(offId) || !ID_RE.test(onId) || offId === onId) return null;
        subs.push({ offId, onId });
      }
      // The same player coming off twice is nonsense (one player, one sub).
      const offs = new Set(subs.map((s) => s.offId));
      if (offs.size !== subs.length) return null;
      return { subs };
    }

    case "shot_predict": {
      const playerId = str(p.playerId);
      if (!playerId || !ID_RE.test(playerId)) return null;
      const grid = validGrid(p.grid);
      if (!grid) return null;
      return { playerId, grid };
    }

    case "player_watch": {
      const playerId = str(p.playerId);
      if (!playerId || !ID_RE.test(playerId)) return null;
      return { playerId };
    }

    case "versus": {
      const playerAId = str(p.playerAId);
      const playerBId = str(p.playerBId);
      if (
        !playerAId ||
        !playerBId ||
        !ID_RE.test(playerAId) ||
        !ID_RE.test(playerBId) ||
        playerAId === playerBId
      ) {
        return null;
      }
      return { playerAId, playerBId };
    }
  }
}
