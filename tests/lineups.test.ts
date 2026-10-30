/** Lineup mapping tests for buildMatchLineups.
 *  Verifies that starters, subs, formation, starter/minutes/face fields
 *  are correctly derived from the API lineups payload.
 *  Uses plain Node.assert so the test runner (tsx tests/run.ts) can invoke it.
 */
import { strict as assert } from "node:assert";
import { buildMatchLineups } from "../src/lib/lineups";

const makePlayer = (overrides: Partial<{
  player_id: string | number;
  full_name: string;
  position: string | null;
  jersey_number: number | null;
  headshot_url: string | null;
  espn_position: string | null;
  formation_place: string | null;
  started: number;
  minutes_played: number | null;
  team_id: string | number;
}>) => ({
  player_id: overrides.player_id ?? 1,
  full_name: overrides.full_name ?? "Test Player",
  position: overrides.position ?? "MID",
  jersey_number: overrides.jersey_number ?? 1,
  headshot_url: overrides.headshot_url ?? "/test-headshot.jpg",
  espn_position: overrides.espn_position ?? "MID",
  formation_place: overrides.formation_place ?? "ST",
  started: overrides.started ?? 1,
  minutes_played: overrides.minutes_played ?? 90,
  team_id: overrides.team_id ?? "home",
});

const players = (count: number, started: number, minutes: number | null, teamId: string) =>
  Array.from({ length: count }, (_, i) =>
    makePlayer({
      player_id: String(i + 1),
      full_name: `P${i + 1}`,
      position: ["GK", "DEF", "MID", "FWD"][i % 4] as string | null,
      jersey_number: i + 1,
      headshot_url: `/test-headshot-${i + 1}.jpg`,
      espn_position: null,
      formation_place: null,
      started,
      minutes_played: minutes,
      team_id: teamId,
    })
  );

export function runLineupsTests(): void {
  // ---- test: default mapping yields 11 starters and subs with minutes > 0 ---
  {
    const data = {
      players: [
        ...players(11, 1, 90, "home"),
        ...players(2, 0, 30, "home"), // subs with >0 mins
        ...players(11, 1, 90, "away"),
        ...players(1, 0, 45, "away"), // sub with >0 mins
        ...players(1, 0, 0, "away"),  // sub with 0 mins - should be excluded
      ],
      home: { formation: "4-3-3" },
      away: { formation: "4-2-3-1" },
    };

    const { homeLineup, awayLineup } = buildMatchLineups(
      data as {
        players: {
          player_id: string | number;
          full_name: string;
          position: string | null;
          jersey_number: number | null;
          headshot_url: string | null;
          espn_position: string | null;
          formation_place: string | null;
          started: number;
          minutes_played: number | null;
          team_id: string | number;
        }[];
        home: { formation?: string };
        away: { formation?: string };
      },
      "home",
      "away"
    );

    // 11 starters per side
    assert.strictEqual(homeLineup.starters.length, 11, "homeLineup.starters length");
    assert.strictEqual(awayLineup.starters.length, 11, "awayLineup.starters length");

    // Only subs with minutes > 0 (the 0-minute sub is excluded)
    assert.strictEqual(homeLineup.subs.length, 2, "homeLineup.subs length (2 subs with >0 mins)");
    assert.strictEqual(awayLineup.subs.length, 1, "awayLineup.subs length (1 sub with >0 mins, 0-minute excluded)");

    // Formation passed through
    assert.strictEqual(homeLineup.formation, "4-3-3", "home formation");
    assert.strictEqual(awayLineup.formation, "4-2-3-1", "away formation");

    // starter and minutes present on every starter
    for (const p of homeLineup.starters) {
      assert.strictEqual(p.starter, true, "home starter starter flag");
      assert.strictEqual(p.minutes, 90, "home starter minutes");
      assert.ok(p.name, "home starter has name");
      assert.ok(p.avatarUrl, "home starter has avatarUrl (face)");
    }
    for (const p of awayLineup.starters) {
      assert.strictEqual(p.starter, true, "away starter starter flag");
      assert.strictEqual(p.minutes, 90, "away starter minutes");
      assert.ok(p.name, "away starter has name");
      assert.ok(p.avatarUrl, "away starter has avatarUrl (face)");
    }
    for (const p of homeLineup.subs) {
      assert.strictEqual(p.starter, false, "home sub starter flag");
      assert.ok(p.minutes > 0, "home sub minutes > 0");
      assert.ok(p.name, "home sub has name");
      assert.ok(p.avatarUrl, "home sub has avatarUrl (face)");
    }
    for (const p of awayLineup.subs) {
      assert.strictEqual(p.starter, false, "away sub starter flag");
      assert.ok(p.minutes > 0, "away sub minutes > 0");
      assert.ok(p.name, "away sub has name");
      assert.ok(p.avatarUrl, "away sub has avatarUrl (face)");
    }
  }

  // ---- test: starter/minutes/avatarUrl present on every player ---
  {
    const data = {
      players: [
        ...players(2, 1, 90, "home"),
        ...players(1, 0, 30, "home"), // 1 sub with >0 mins
        ...players(2, 1, 90, "away"),
        ...players(1, 0, 0, "away"), // 1 sub with 0 mins - should be excluded
      ],
      home: { formation: "4-3-3" },
      away: { formation: "4-3-3" },
    };

    const { homeLineup, awayLineup } = buildMatchLineups(
      data as {
        players: {
          player_id: string | number;
          full_name: string;
          position: string | null;
          jersey_number: number | null;
          headshot_url: string | null;
          espn_position: string | null;
          formation_place: string | null;
          started: number;
          minutes_played: number | null;
          team_id: string | number;
        }[];
        home: { formation?: string };
        away: { formation?: string };
      },
      "home",
      "away"
    );

    // Every starter has starter=true and minutes > 0
    for (const p of [...homeLineup.starters, ...awayLineup.starters]) {
      assert.strictEqual(p.starter, true, "starter flag true");
      assert.strictEqual(p.minutes, 90, "minutes = 90");
    }

    // Subs: only those with minutes > 0; the 0-minute sub is excluded
    assert.strictEqual(homeLineup.subs.length, 1, "1 sub with >0 mins in home");
    assert.strictEqual(awayLineup.subs.length, 0, "0 subs with >0 mins in away");

    // Every player has avatarUrl (face) - this is the new assertion
    const allPlayers = [
      ...homeLineup.starters,
      ...homeLineup.subs,
      ...awayLineup.starters,
      ...awayLineup.subs,
    ];
    for (const p of allPlayers) {
      assert.ok(p.avatarUrl, "avatarUrl present (face)");
      assert.ok(p.id, "id present");
      assert.ok(p.name, "name present");
      assert.ok(p.position, "position present");
      assert.ok(typeof p.number === "number", "number is a number");
    }
  }

  console.log("  lineups: all assertions passed");
}
