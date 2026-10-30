/**
 * Whether the server-push channel is currently delivering.
 *
 * The app has two paths to a new score: the SSE stream (instant) and React
 * Query's polling (the backstop). When the stream drops — a backgrounded phone,
 * a proxy that recycles idle connections, a deploy — nothing used to say so, and
 * a page could sit on a stale minute with no way to tell whether the match had
 * gone quiet or the link had. This is the tiny store behind an honest line:
 * `useLiveUpdates` owns the value, screens read it.
 */

let connected = true;
const listeners = new Set<() => void>();

export function setLiveLinkConnected(next: boolean): void {
  if (connected === next) return;
  connected = next;
  for (const listener of listeners) listener();
}

export function subscribeLiveLink(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLiveLinkConnected(): boolean {
  return connected;
}
