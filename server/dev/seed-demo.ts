/**
 * DEV-ONLY entry point for the demo dataset. Run it with:
 *
 *   npm run seed:demo                 # add the demo cohort (idempotent-ish)
 *   npm run seed:demo -- --reset      # wipe the demo cohort first, then re-seed
 *   npm run seed:demo -- --users 10 --matches 20
 *
 * Everything it writes is fake and clearly labelled. It refuses to run under
 * NODE_ENV=production — see assertNotProduction in ./seedDemoData.ts for why
 * the guard exists and where it is enforced.
 */
import { getDb } from "../db/index.js";
import { assertNotProduction, seedDemoData } from "./seedDemoData.js";

const args = process.argv.slice(2);

function flagValue(name: string): number | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const raw = Number(args[i + 1]);
  return Number.isFinite(raw) ? raw : undefined;
}

function main(): void {
  try {
    assertNotProduction(process.env);
  } catch (err) {
    console.error(`[seed-demo] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const db = getDb();
  const report = seedDemoData(db, {
    users: flagValue("--users"),
    matches: flagValue("--matches"),
    reset: args.includes("--reset"),
  });

  console.log("[seed-demo] demo data written (DEV ONLY — never seed production)");
  console.log(
    `  users ${report.users} · predictions ${report.predictions} (${report.resolved} resolved) · ` +
      `ratings ${report.ratings} · ledger awards ${report.awards} · ${report.totalPoints} points`,
  );
  console.log(`  matches used: ${report.matchesUsed}`);
  for (const note of report.skipped.slice(0, 5)) console.log(`  skipped ${note}`);
  if (report.skipped.length > 5) console.log(`  …and ${report.skipped.length - 5} more skipped`);

  console.log(
    "\n  Sign in as a demo user with the dev escape hatch (DEV_AUTH_SECRET must be set):\n" +
      "    npm run sync -- dev-token 900001\n" +
      "  then open the app with ?devUser=900001 appended to the URL.",
  );
}

main();