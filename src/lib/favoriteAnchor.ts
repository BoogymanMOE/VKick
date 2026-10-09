/**
 * Follow-then-anchor ordering for a user's FIRST club pick.
 *
 * The anchor endpoint (`PUT /api/me/favorites/:teamId/anchor`) answers 404
 * NOT_FOLLOWING unless the follow row already exists, so the two writes must
 * never race. Onboarding used to fire them concurrently (`toggle(team)` then
 * `setAnchor.mutate` immediately) and the anchor lost — silently, because the
 * mutation had no onError — leaving brand-new users with zero anchors and
 * violating the schema's "exactly one anchor" invariant (12 users had hit it
 * by audit time).
 *
 * This helper owns the ordering so it can be regression-tested without a DOM:
 *   - `follow` must settle successfully before `anchor` is called AT ALL; if
 *     it rejects, the error propagates and the anchor never fires.
 *   - a TRANSIENT anchor failure (network error, 5xx, 429) is retried once;
 *     a terminal 4xx (e.g. 404) is not — it will not fix itself.
 *   - the final failure is rethrown; the caller's error handler surfaces it.
 */

export interface FollowThenAnchorOptions {
  /** Retry attempts after the first anchor failure. Default 1. */
  anchorRetries?: number;
  /** Delay before each retry. Default 300ms. */
  retryDelayMs?: number;
  /** Injectable clock for tests; default is a real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Which anchor failures are worth retrying. Default: `isRetryableAnchorError`. */
  isRetryable?: (err: unknown) => boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retry classification: a failure with NO status is a network layer error
 * (fetch TypeError), 5xx is the server having a moment, 429 is the write
 * rate limiter — all transient. Every other 4xx is a decision the server
 * already made (NOT_FOLLOWING, MAX_CLUBS…) and retrying it wastes a request.
 */
export function isRetryableAnchorError(err: unknown): boolean {
  const status = (err as { status?: number } | null | undefined)?.status;
  return status === undefined || status >= 500 || status === 429;
}

/**
 * Follow `teamId`, then set it as the anchor club — strictly in that order,
 * with one bounded retry on the anchor step. See module doc for the bug this
 * exists to prevent.
 */
export async function followThenAnchor(
  teamId: string,
  follow: (teamId: string) => Promise<unknown>,
  anchor: (teamId: string) => Promise<unknown>,
  options: FollowThenAnchorOptions = {},
): Promise<void> {
  const sleep = options.sleep ?? defaultSleep;
  const retryable = options.isRetryable ?? isRetryableAnchorError;
  const retries = options.anchorRetries ?? 1;

  // The follow MUST land first. A rejection here propagates untouched and the
  // anchor never fires — the caller's follow-error handler owns the toast.
  await follow(teamId);

  let failures = 0;
  for (;;) {
    try {
      await anchor(teamId);
      return;
    } catch (err) {
      failures += 1;
      if (failures > retries || !retryable(err)) throw err;
      await sleep(options.retryDelayMs ?? 300);
    }
  }
}

/**
 * A SYNCHRONOUS first-pick coordinator for the picker.
 *
 * `followThenAnchor` fixes the follow-before-anchor ordering, but it is still
 * called once per pick — so two club tiles tapped in the SAME tick (both see
 * the favorite count as 0, before the optimistic update re-renders the list)
 * both run the anchor step, and the last PUT wins: two anchor requests fire and
 * the anchor ends up on the second club instead of the first.
 *
 * This wraps that flow with an in-tick claim: the FIRST pick takes the claim
 * and owns the anchor; any pick that arrives while the first is still in flight
 * is only FOLLOWED (never anchored). The claim is released when the first flow
 * settles, so a genuine retry after a failure can still anchor. The claim is
 * set and read synchronously, so no amount of same-tick batching can slip a
 * second anchor through.
 */
export function createFirstPickCoordinator(
  follow: (teamId: string) => Promise<unknown>,
  anchor: (teamId: string) => Promise<unknown>,
): (teamId: string) => Promise<void> {
  let claimed = false;
  return function pick(teamId: string): Promise<void> {
    if (claimed) return follow(teamId).then(() => undefined);
    claimed = true;
    return followThenAnchor(teamId, follow, anchor).finally(() => {
      claimed = false;
    });
  };
}
