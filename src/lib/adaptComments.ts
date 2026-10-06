import type { ApiComment } from "./api";
import type { Comment } from "../types";

/**
 * Server → view adapter: flags your own cards so they render amber.
 *
 * Sits in lib rather than in `components/panels/CommentsPanel` so that file
 * exports only components (Fast Refresh can't hot-patch a module that also
 * exports plain helpers), and because MatchDetail calls it directly too.
 */
export function adaptComments(rows: ApiComment[], myUserId: number | undefined): Comment[] {
  return rows.map((c) => ({
    id: String(c.id),
    eventId: c.event_id !== null && c.event_id !== undefined ? String(c.event_id) : null,
    matchId: c.match_id,
    minuteDisplay: c.minute_display,
    minuteSeconds: c.minute_seconds,
    author: c.author,
    authorId: c.user_id,
    text: c.text,
    mediaLink: c.media_link,
    isMine: myUserId !== undefined && c.user_id === myUserId,
  }));
}
