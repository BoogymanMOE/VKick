import { syncScoreboardWindow, syncFixtureHorizon } from "../server/sync/service.ts";
console.log("Starting season backfill...");
await syncScoreboardWindow(120, 120);
console.log("Scoreboard window done.");
await syncFixtureHorizon();
console.log("Fixture horizon done.");
