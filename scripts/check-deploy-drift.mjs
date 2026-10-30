/**
 * Deploy-drift check for CI: is production actually running latest main?
 *
 * The server carries its identity on /health (see server/appInfo.ts) —
 * `commit` is the short sha the process booted from (RENDER_GIT_COMMIT, which
 * Render sets on push deploys, else git itself). Prod behind main is the
 * silent failure mode of a broken auto-deploy: bugs "fixed" in the repo keep
 * reproducing in the app for days, exactly what happened to the standings
 * form strip.
 *
 * Rule: prod's commit must BE the expected commit. Days-old drift fails even
 * when prod's commit is an ancestor of main — being an ancestor only proves
 * it's old code, not that the pipeline works. The workflow runs on a schedule
 * so a normally-paced deploy never looks like drift.
 *
 * Env:
 *   PROD_HEALTH_URL   the /health endpoint to read (default the Render app)
 *   EXPECTED_COMMIT   full sha of the commit main should deploy
 *   PROD_WAKE_RETRIES Render free-tier apps spin down; first hits may wake
 *                     a cold instance (up to ~50s). Retries cover the wake.
 */

const HEALTH_URL = process.env.PROD_HEALTH_URL ?? "";
const EXPECTED = (process.env.EXPECTED_COMMIT ?? "").slice(0, 7);
const RETRIES = Number.parseInt(process.env.PROD_WAKE_RETRIES ?? "3", 10);

if (!HEALTH_URL || !EXPECTED) {
  console.error("deploy-drift: PROD_HEALTH_URL and EXPECTED_COMMIT are required");
  process.exit(2);
}

async function readHealth() {
  try {
    // A hard client timeout: a hung cold boot must not use the runner hour.
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const body = await res.json();
    if (typeof body.commit !== "string" || body.commit.length < 4) return null;
    return { commit: body.commit.slice(0, 7), builtAt: body.builtAt ?? "?" };
  } catch {
    return null;
  }
}

function log(msg) {
  console.log(msg);
}

let health = null;
for (let attempt = 1; attempt <= RETRIES; attempt++) {
  health = await readHealth();
  if (health) break;
  log(`deploy-drift: /health did not answer (attempt ${attempt}/${RETRIES}) — retrying in 20s`);
  if (attempt < RETRIES) await new Promise((r) => setTimeout(r, 20_000));
}

if (!health) {
  console.error(`deploy-drift: FAIL — ${HEALTH_URL} never answered a healthy /health.`);
  console.error("  Production is unreachable or broken. Check the Render dashboard.");
  // exitCode, not exit(): exit() mid-async can race aborted-timer cleanup and
  // mask the real code behind a 137/127-style crash (Windows showed 127).
  process.exitCode = 1;
} else {
  log(`deploy-drift: production is at ${health.commit} (started ${health.builtAt}); main expects ${EXPECTED}`);
  if (health.commit !== EXPECTED) {
    console.error(
      `deploy-drift: FAIL — production runs ${health.commit} but main is at ${EXPECTED}.`,
    );
    console.error("  The latest commit never deployed. Trigger a Manual Deploy in the");
    console.error("  Render dashboard, then re-run this check.");
    process.exitCode = 1;
  } else {
    log("deploy-drift: OK — production matches main.");
  }
}
