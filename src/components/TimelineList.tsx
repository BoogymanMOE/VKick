import { Fragment } from "react";
import type { ReactNode } from "react";
import type { Comment, TimelineEvent } from "../types";
import { useI18n } from "../i18n/I18nProvider";
import type { StringKey } from "../i18n/strings";
import { BallIcon } from "./icons";
import { Chip, Num, cx } from "./ui";

export const typeKey: Record<TimelineEvent["type"], StringKey> = {
  goal: "timeline.goal",
  card: "timeline.card",
  substitution: "timeline.sub",
  var: "timeline.var",
  halftime: "timeline.halftime",
  fulltime: "timeline.fulltime",
};

// Monochrome marks only: a full-colour emoji breaks the one-meaning-per-colour
// rule and renders differently on every platform. The ball uses the real icon.
const typeGlyph: Record<TimelineEvent["type"], ReactNode> = {
  goal: <BallIcon className="h-3.5 w-3.5" strokeWidth={2} />,
  card: (
    <svg viewBox="0 0 12 14" className="h-3.5 w-3" aria-hidden="true">
      <rect x="1.5" y="1.5" width="9" height="11" rx="1.5" fill="currentColor" transform="rotate(-12 6 7)" />
    </svg>
  ),
  substitution: "⇄",
  var: "◇",
  halftime: "‖",
  fulltime: "■",
};

/**
 * A pinned comment belongs to a minute either directly (minute_seconds) or
 * through its event. Minute-only pins render in the gap after the last event
 * at or before their minute — the timeline stays chronological.
 */
function commentsForWindow(
  comments: Comment[],
  fromSeconds: number,
  toSeconds: number | null,
  eventId: string | null,
): Comment[] {
  return comments.filter((c) => {
    if (eventId && c.eventId === eventId) return true;
    if (eventId && c.eventId) return false; // pinned to a different event
    if (c.eventId) return false; // event pins render under their own event
    const s = c.minuteSeconds ?? 0;
    return s >= fromSeconds && (toSeconds === null || s < toSeconds);
  });
}

function PinnedComment({
  comment,
  onOpenClip,
}: {
  comment: Comment;
  onOpenClip: (comment: Comment) => void;
}) {
  const { t, localize } = useI18n();
  return (
    <div
      className={cx(
        "mt-2 rounded-card border p-2.5",
        comment.isMine ? "border-gold/40 bg-elevated" : "border-line bg-base",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className="grid h-6 w-6 flex-none place-items-center rounded-full border border-line bg-surface text-[10px] font-extrabold text-ink-2"
          aria-hidden="true"
        >
          {(comment.isMine ? t("comments.you") : comment.author).slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-bold text-ink-2">
          {comment.isMine ? t("comments.you") : comment.author}
        </span>
        {comment.mediaLink ? (
          <button
            type="button"
            onClick={() => onOpenClip(comment)}
            className="flex-none text-[11px] font-bold text-volt underline-offset-2 hover:underline"
          >
            {t("comments.attachOpen")} ↗
          </button>
        ) : null}
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-ink">{localize(comment.text)}</p>
    </div>
  );
}

export function TimelineList({
  events,
  comments = [],
  liveMinute,
  onOpenClip,
}: {
  events: TimelineEvent[];
  /** Pinned crowd comments, rendered under their event/minute. */
  comments?: Comment[];
  liveMinute?: number;
  /** Handler for opening a comment's clip link (validated https by the server). */
  onOpenClip?: (comment: Comment) => void;
}) {
  const { t, localize } = useI18n();

  const latestSeconds = liveMinute === undefined ? null : Math.max(...events.map((e) => e.minuteSeconds), 0);
  const openClip = (comment: Comment) => (onOpenClip ? onOpenClip(comment) : undefined);

  return (
    <ol className="relative space-y-2 ps-4">
      {/* Vertical timeline rail. */}
      <span className="absolute inset-y-1 start-[7px] w-px bg-line" aria-hidden="true" />

      {events.map((event, index) => {
        const isGoal = event.type === "goal";
        const isNewestLive =
          latestSeconds !== null && event.minuteSeconds === latestSeconds && liveMinute !== undefined;
        const next = events[index + 1];
        // Comments pinned to this event, plus minute-pins falling in this
        // event's window [event.start, next.start).
        const pinned = commentsForWindow(
          comments,
          event.minuteSeconds,
          next ? next.minuteSeconds : null,
          event.id,
        );
        const count = event.commentCount + (event.commentCount > 0 ? 0 : pinned.length);

        return (
          <Fragment key={event.id}>
            <li className="timeline-in relative" style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}>
              {/* Node on the rail; goals get the volt fill. */}
              <span
                className={cx(
                  "absolute -start-[13px] top-4 h-[9px] w-[9px] rounded-full border",
                  isGoal ? "border-volt bg-volt" : "border-line bg-elevated",
                )}
                aria-hidden="true"
              />

              <div
                className={cx(
                  "rounded-card border bg-surface p-3",
                  isGoal ? "border-volt/40" : "border-line",
                  isNewestLive && "live-edge",
                )}
              >
                <div className="flex items-center gap-2">
                  <Num className="grid h-6 min-w-[38px] place-items-center rounded-md border border-line bg-elevated px-1 text-[11px] text-ink-2">
                    {event.minuteDisplay}
                  </Num>
                  <Chip tone={isGoal ? "volt" : "muted"}>
                    <span aria-hidden="true">{typeGlyph[event.type]}</span>
                    {t(typeKey[event.type])}
                  </Chip>
                  {/* The crowd thread on this moment — surfaced, not buried. */}
                  {count > 0 ? (
                    <span className="ms-auto inline-flex items-center gap-1 text-[11px] font-bold text-gold">
                      <span aria-hidden="true">💬</span>
                      <Num>{event.commentCount}</Num>
                    </span>
                  ) : null}
                </div>

                <p className="mt-2 text-sm text-ink">{event.description}</p>

                {event.participants.length > 0 ? (
                  <p className="mt-1 text-xs text-ink-2">{event.participants.map(localize).join(" · ")}</p>
                ) : null}
              </div>

              {/* Pinned reactions live INSIDE the event's slot, directly under it. */}
              {pinned.map((comment) => (
                <PinnedComment key={comment.id} comment={comment} onOpenClip={openClip} />
              ))}
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}
