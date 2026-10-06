/**
 * Prediction summaries must name people and places, never ids.
 *
 * Stored payloads are keyed by ESPN athlete id and the shot grid is a cell
 * index. Both are fine in the database and useless on screen: "Your pick's
 * stat score 8 / Rival's 5" tells you nothing about WHO, and a shot
 * prediction is "this player, from here" — dropping the zone hides half the
 * thing the user chose.
 *
 * These pin both halves: the server attaches real names for exactly the ids
 * each mechanic references, and the client renders them (with zone labels) in
 * EN and FA without ever printing a raw id.
 */
import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrate } from "../server/db/schema.js";
import { attachPlayerNames, playerIdsForMechanic } from "../server/predictions/pickNames.js";
import { pickSummary } from "../src/lib/breakdown.js";
import { cellZone, ZONE_LABEL_KEY } from "../src/lib/zones.js";
import { strings } from "../src/i18n/strings";

const NAMES: Record<string, string> = {
  "101": "Bukayo Saka",
  "102": "Martin Ødegaard",
  "103": "Kai Havertz",
  "104": "Jude Bellingham",
  "105": "Vinícius Júnior",
};

export function runPickSummaryTests(): void {
  /* ------------------------------------------- id extraction (server) */

  assert.deepEqual(playerIdsForMechanic("versus", JSON.stringify({ playerAId: "101", playerBId: "105" })), [
    "101",
    "105",
  ]);
  assert.deepEqual(playerIdsForMechanic("player_watch", JSON.stringify({ playerId: "103" })), ["103"]);
  assert.deepEqual(
    playerIdsForMechanic("shot_predict", JSON.stringify({ playerId: "101", grid: { gridX: 4, gridY: 0 } })),
    ["101"],
    "the grid cell is not a player",
  );
  assert.deepEqual(
    playerIdsForMechanic(
      "sub",
      JSON.stringify({
        subs: [
          { offId: "101", onId: "102" },
          { offId: "103", onId: "104" },
        ],
      }),
    ),
    ["101", "102", "103", "104"],
  );
  assert.deepEqual(
    playerIdsForMechanic("lineup", JSON.stringify({ playerIds: ["101", "102"], formation: "4-3-3" })),
    ["101", "102"],
  );

  // Garbage in, nothing out — never a throw out of a render path.
  for (const bad of [null, "", "not json", "[]", '"x"', "42", JSON.stringify({ playerId: 7 })]) {
    assert.deepEqual(playerIdsForMechanic("versus", bad), [], `garbage payload: ${bad}`);
  }
  assert.deepEqual(playerIdsForMechanic("unknown_mechanic", JSON.stringify({ playerId: "101" })), []);
  // A formation string is not a numeric id, so it can't be mistaken for one.
  assert.deepEqual(
    playerIdsForMechanic("lineup", JSON.stringify({ playerIds: ["4-3-3"], formation: "4-3-3" })),
    [],
  );

  /* ------------------------------------------- name attachment (server) */

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vkick-picks-"));
  const db = new DatabaseSync(path.join(dir, "picks.db"));
  try {
    migrate(db);
    db.exec("INSERT INTO teams (id, name, league) VALUES ('t1','A','eng.1'), ('t2','B','eng.1')");
    for (const [id, full_name] of Object.entries(NAMES)) {
      db.prepare("INSERT INTO players (id, team_id, full_name) VALUES (?, 't1', ?)").run(id, full_name);
    }

    const rows = [
      { mechanic: "versus", payload: JSON.stringify({ playerAId: "101", playerBId: "105" }) },
      {
        mechanic: "shot_predict",
        payload: JSON.stringify({ playerId: "102", grid: { gridX: 4, gridY: 0 } }),
      },
      { mechanic: "lineup", payload: JSON.stringify({ playerIds: ["101", "999"], formation: "4-3-3" }) },
    ];
    const out = attachPlayerNames(db, rows as unknown as Array<Record<string, unknown>>);

    assert.equal(out[0]?.player_names["101"], "Bukayo Saka");
    assert.equal(out[0]?.player_names["105"], "Vinícius Júnior");
    assert.equal(out[1]?.player_names["102"], "Martin Ødegaard");
    // "999" was never synced: absent, so the client falls back to #999 rather
    // than the row disappearing or rendering a wrong name.
    assert.equal(out[2]?.player_names["999"], undefined);
    assert.equal(out[2]?.player_names["101"], "Bukayo Saka");
    // Original payload untouched — names are additive.
    assert.equal((out[0] as { payload: string }).payload, rows[0]!.payload);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  /* ------------------------------------------- rendering (client) */

  for (const lang of ["en", "fa"] as const) {
    const t = (key: string, vars?: Record<string, string | number>): string => {
      let out: string =
        strings[lang][key as keyof typeof strings.en] ?? strings.en[key as keyof typeof strings.en] ?? key;
      if (vars) for (const [n, v] of Object.entries(vars)) out = out.replaceAll(`{${n}}`, String(v));
      return out;
    };
    const nameOf = (id: string): string => NAMES[id] ?? `#${id}`;
    const ctx = { t, nameOf };

    const versus = pickSummary("versus", JSON.stringify({ playerAId: "101", playerBId: "105" }), ctx);
    assert.ok(versus, "versus summarizes");
    assert.match(versus, /Bukayo Saka/, `${lang}: versus names A`);
    assert.match(versus, /Vinícius Júnior/, `${lang}: versus names B`);
    assert.ok(!/\b101\b|\b105\b/.test(versus), `${lang}: versus leaks no raw id`);

    // Shot Predictor must carry BOTH halves of the pick.
    const zone = cellZone(4, 0);
    const shot = pickSummary(
      "shot_predict",
      JSON.stringify({ playerId: "102", grid: { gridX: 4, gridY: 0 } }),
      ctx,
    );
    assert.ok(shot, `${lang}: shot_predict summarizes`);
    assert.match(shot, /Martin Ødegaard/, `${lang}: shot_predict names the player`);
    assert.match(shot, new RegExp(escapeRe(t(ZONE_LABEL_KEY[zone]))), `${lang}: shot_predict names the zone`);
    assert.ok(!/grid/i.test(shot), `${lang}: no raw grid in the summary`);

    // Sub: names the pair, collapses the rest.
    const sub = pickSummary(
      "sub",
      JSON.stringify({
        subs: [
          { offId: "101", onId: "102" },
          { offId: "103", onId: "104" },
        ],
      }),
      ctx,
    );
    assert.ok(sub, `${lang}: sub summarizes`);
    assert.match(sub, /Bukayo Saka/, `${lang}: sub names who comes off`);
    assert.match(sub, /Martin Ødegaard/, `${lang}: sub names who comes on`);
    assert.ok(!/\b10[1-4]\b/.test(sub), `${lang}: sub leaks no raw id`);
    assert.match(sub, /\+1/, `${lang}: collapsed pairs counted`);

    const onePair = pickSummary("sub", JSON.stringify({ subs: [{ offId: "101", onId: "102" }] }), ctx);
    assert.ok(!/\+/.test(onePair ?? ""), `${lang}: no "+N more" when there is nothing more`);

    const watch = pickSummary("player_watch", JSON.stringify({ playerId: "103" }), ctx);
    assert.equal(watch, "Kai Havertz");

    // Lineup stays a count + formation: eleven names is a wall of text and the
    // XI is already on the match page.
    const lineup = pickSummary(
      "lineup",
      JSON.stringify({ playerIds: NAMES ? Object.keys(NAMES) : [], formation: "4-3-3" }),
      ctx,
    );
    assert.equal(lineup, "5 · 4-3-3");
    assert.ok(!/Saka/.test(lineup ?? ""), `${lang}: lineup does not list names`);

    // Nothing to say is null, not an empty string or a stray "#".
    for (const bad of [null, "", "nope", JSON.stringify({})]) {
      assert.equal(pickSummary("versus", bad, ctx), null, `${lang}: empty payload → null`);
      assert.equal(pickSummary("shot_predict", bad, ctx), null, `${lang}: empty payload → null`);
    }

    // Every zone label exists in both languages and is non-empty.
    for (const key of Object.values(ZONE_LABEL_KEY)) {
      assert.ok(strings.en[key].length > 0, `EN label missing for ${key}`);
      assert.ok(strings.fa[key].length > 0, `FA label missing for ${key}`);
    }
    assert.ok(
      strings.en["predict.morePairs"] && strings.fa["predict.morePairs"],
      "morePairs in both languages",
    );
  }

  console.log(
    "  pickSummary: server name resolution + EN/FA summaries for sub/shot_predict/versus/watch, no raw ids OK",
  );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
