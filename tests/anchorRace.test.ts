/**
 * Regression for the onboarding anchor race.
 *
 * The bug: `pickClub` fired the follow POST and the anchor PUT concurrently,
 * so the anchor reached the server before the follow row existed and 404'd —
 * with no onError, so nothing visible happened and new users ended up with
 * zero anchors (the schema promises exactly one).
 *
 * These tests pin the helper that now owns the ordering (`followThenAnchor`):
 * the anchor must never be attempted before the follow has succeeded, a
 * transient anchor failure gets exactly one retry, a terminal 4xx does not,
 * and failures propagate so the UI can surface them.
 */
import { strict as assert } from "node:assert";
import {
  createFirstPickCoordinator,
  followThenAnchor,
  isRetryableAnchorError,
} from "../src/lib/favoriteAnchor.js";

/** An ApiRequestError-shaped failure (src/lib/api.ts attaches `status`). */
function httpError(status: number): Error & { status: number } {
  const err = new Error(`HTTP ${status}`) as Error & { status: number };
  err.status = status;
  return err;
}

export async function runAnchorRaceTests(): Promise<void> {
  const noSleep = async (): Promise<void> => {};

  // 1. Ordering: follow first, anchor strictly after — never interleaved.
  {
    const calls: string[] = [];
    await followThenAnchor(
      "359",
      async (id) => {
        calls.push(`follow:${id}`);
      },
      async (id) => {
        calls.push(`anchor:${id}`);
      },
      { sleep: noSleep },
    );
    assert.deepEqual(calls, ["follow:359", "anchor:359"], "anchor must fire only after the follow");
  }

  // 2. The race itself: follow rejects → the anchor is NEVER attempted and
  //    the original error propagates for the caller's handler.
  {
    const boom = new Error("MAX_CLUBS");
    const calls: string[] = [];
    await assert.rejects(
      followThenAnchor(
        "359",
        async () => {
          calls.push("follow");
          throw boom;
        },
        async () => {
          calls.push("anchor");
        },
        { sleep: noSleep },
      ),
      (err: unknown) => err === boom,
      "the follow's error must propagate unchanged",
    );
    assert.deepEqual(calls, ["follow"], "anchor must never fire when the follow failed");
  }

  // 3. Transient anchor failure (5xx / network) → retried once, then succeeds.
  {
    const calls: string[] = [];
    let anchorAttempts = 0;
    await followThenAnchor(
      "359",
      async () => {
        calls.push("follow");
      },
      async () => {
        anchorAttempts += 1;
        calls.push(`anchor:${anchorAttempts}`);
        if (anchorAttempts === 1) throw httpError(503);
      },
      { sleep: noSleep },
    );
    assert.deepEqual(
      calls,
      ["follow", "anchor:1", "anchor:2"],
      "a transient anchor failure must be retried after the follow",
    );
  }

  // 4. Terminal 4xx (NOT_FOLLOWING) → no retry, error propagates.
  {
    let anchorAttempts = 0;
    const notFollowing = httpError(404);
    await assert.rejects(
      followThenAnchor(
        "359",
        async () => {},
        async () => {
          anchorAttempts += 1;
          throw notFollowing;
        },
        { sleep: noSleep },
      ),
      (err: unknown) => err === notFollowing,
    );
    assert.equal(anchorAttempts, 1, "a terminal 4xx must not be retried");
  }

  // 5. Retries are bounded: still failing after the retry → propagate.
  {
    let anchorAttempts = 0;
    let sleeps = 0;
    await assert.rejects(
      followThenAnchor(
        "359",
        async () => {},
        async () => {
          anchorAttempts += 1;
          throw httpError(500);
        },
        {
          sleep: async () => {
            sleeps += 1;
          },
        },
      ),
      (err: unknown) => (err as { status?: number }).status === 500,
    );
    assert.equal(anchorAttempts, 2, "exactly one retry after the first failure");
    assert.equal(sleeps, 1, "exactly one backoff wait between the attempts");
  }

  // 6. Retry classification: transient (no status / 5xx / 429) vs terminal 4xx.
  {
    assert.equal(
      isRetryableAnchorError(Object.assign(new Error("fetch failed"), { status: undefined })),
      true,
    );
    assert.equal(isRetryableAnchorError(httpError(500)), true);
    assert.equal(isRetryableAnchorError(httpError(502)), true);
    assert.equal(isRetryableAnchorError(httpError(429)), true);
    assert.equal(isRetryableAnchorError(httpError(404)), false);
    assert.equal(isRetryableAnchorError(httpError(400)), false);
    assert.equal(isRetryableAnchorError(httpError(403)), false);
  }

  // 7. Same-tick double pick: two club tiles tapped in ONE tick (both still see
  //    count 0) must follow both clubs but send exactly ONE anchor request, and
  //    that anchor must be the FIRST-picked club — not the last one to finish.
  {
    const calls: string[] = [];
    const pick = createFirstPickCoordinator(
      async (id) => {
        calls.push(`follow:${id}`);
      },
      async (id) => {
        calls.push(`anchor:${id}`);
      },
    );
    // Fired together, before either has settled.
    await Promise.all([pick("359"), pick("349")]);
    assert.deepEqual(
      calls.filter((c) => c.startsWith("anchor:")),
      ["anchor:359"],
      "exactly one anchor request, for the first-picked club",
    );
    assert.deepEqual(
      calls.filter((c) => c.startsWith("follow:")).sort(),
      ["follow:349", "follow:359"],
      "both clubs are still followed",
    );

    // The claim releases when the first flow settles, so a later genuine pick
    // (e.g. after a failed first attempt) can still claim the anchor.
    await pick("111");
    assert.equal(
      calls.filter((c) => c.startsWith("anchor:")).at(-1),
      "anchor:111",
      "a later pick can anchor once the previous flow has settled",
    );
  }

  console.log("  anchor ordering + retry OK");
}
