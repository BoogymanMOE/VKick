import { Fragment, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Comment, TimelineEvent } from "../types";
import { useI18n } from "../i18n/context";
import type { StringKey } from "../i18n/strings";
import { BallIcon, CardIcon, SwapIcon } from "./icons";
import { cx } from "../lib/cx";
import { formatScore, runningScore } from "../lib/timelineScore";
import { Chip, Num } from "./ui";

const typeKey: Record<TimelineEvent["type"], StringKey> = {
  goal: "timeline.goal",
  card: "timeline.card",
  substitution: "timeline.sub",
  var: "timeline.var",
  halftime: "timeline.halftime",
  fulltime: "timeline.fulltime",
};

/**
 * The mark inside an event's marker on the rail — drawn, never emoji. A
 * full-colour emoji ignores currentColor, renders differently on every
 * platform and breaks the one-meaning-per-colour rule (design-system.md §3),
 * so colour does the work the emoji would have: a goal is --volt, a booking
 * --gold, a sending-off --danger.
 */
function eventMark(type: TimelineEvent["type"], description: string): { glyph: ReactNode; tone: string } {
  switch (type) {
    case "goal":
      return { glyph: <BallIcon className="h-4 w-4" strokeWidth={2} />, tone: "text-volt" };
    case "card":
      // ESPN folds a red — including a second yellow — into `card`, so its text
      // is the only signal that the booking emptied the pitch.
      return {
        glyph: <CardIcon className="h-4 w-4" />,
        tone: /\bred card\b|second yellow/i.test(description) ? "text-danger" : "text-gold",
      };
    case "substitution":
      return { glyph: <SwapIcon className="h-4 w-4" />, tone: "text-ink-2" };
    case "var":
      return { glyph: "◇", tone: "text-ink-2" };
    case "halftime":
      return { glyph: "‖", tone: "text-ink-2" };
    case "fulltime":
      return { glyph: "■", tone: "text-ink-2" };
  }
}

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
  teamColor,
  teamNames,
  homeTeamId,
  awayTeamId,
}: {
  events: TimelineEvent[];
  /** Pinned crowd comments, rendered under their event/minute. */
  comments?: Comment[];
  liveMinute?: number;
  /** Handler for opening a comment's clip link (validated https by the server). */
  onOpenClip?: (comment: Comment) => void;
  /**
   * teamId → club colour. The marker on the rail is tinted with the side that
   * caused the moment, so a two-column read of who did what needs no names.
   */
  teamColor?: Record<string, string>;
  /**
   * teamId → localized club name. A card names the player(s) and the side, not
   * the English sentence the feed carries ("… Yellow Card at 12'"), which in a
   * Persian page scrambles the bidi run and repeats the player name.
   */
  teamNames?: Record<string, string>;
  /** The match's two sides, so a goal can carry the scoreline it produced. */
  homeTeamId?: string;
  awayTeamId?: string;
}) {
  const { t, localize } = useI18n();

  const latestSeconds = liveMinute === undefined ? null : Math.max(...events.map((e) => e.minuteSeconds), 0);
  const openClip = (comment: Comment) => (onOpenClip ? onOpenClip(comment) : undefined);

  // "Goal — Cole Palmer" on its own never said what the goal DID to the match.
  // The score beside each goal is a prefix count of the timeline's own goals,
  // credited to the side each event names (src/lib/timelineScore.ts), so a
  // goal reads "1–0" the moment it lands rather than leaving the reader to
  // scroll up to the scoreboard.
  const { byGoal } = useMemo(
    () => runningScore(events, homeTeamId ?? "", awayTeamId ?? ""),
    [events, homeTeamId, awayTeamId],
  );

  return (
    <ol className="relative space-y-3 ps-10">
      {/* Vertical timeline rail, one continuous line the markers sit on. */}
      <span className="absolute inset-y-1 start-[13px] w-px bg-line" aria-hidden="true" />

      {events.map((event, index) => {
        const isGoal = event.type === "goal";
        const goalScore = byGoal.get(event.id);
        const mark = eventMark(event.type, event.description);
        const club = event.teamId ? teamColor?.[event.teamId] : undefined;
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
            <li
              className="timeline-in relative"
              style={{ "--stagger": `${Math.min(index, 8) * 40}ms` } as CSSProperties}
            >
              {/* Marker on the rail: the event's mark over a wash of the club
                  that caused it. Halftimes and finals have no club, so they
                  keep the quiet elevated fill. */}
              <span
                className={cx(
                  "absolute -start-10 top-2.5 grid h-7 w-7 place-items-center rounded-full border bg-elevated",
                  mark.tone,
                )}
                style={
                  club
                    ? {
                        borderColor: `color-mix(in srgb, ${club} 60%, transparent)`,
                        backgroundColor: `color-mix(in srgb, ${club} 22%, var(--bg-elevated))`,
                      }
                    : undefined
                }
                aria-hidden="true"
              >
                {mark.glyph}
              </span>

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
                  <Chip tone={isGoal ? "volt" : "muted"}>{t(typeKey[event.type])}</Chip>
                  {/* The scoreline this goal produced. Always home–away, so the
                      number reads the same whichever side scored it. */}
                  {goalScore ? (
                    <Num className="text-sm font-black text-volt">{formatScore(goalScore)}</Num>
                  ) : null}
                  {/* The crowd thread on this moment — surfaced, not buried. */}
                  {count > 0 ? (
                    <span className="ms-auto inline-flex items-center gap-1 text-[11px] font-bold text-gold">
                      <span aria-hidden="true">💬</span>
                      <Num>{count}</Num>
                    </span>
                  ) : null}
                </div>

                {/* Player(s) and side — never the feed's English sentence. For a
                    break (half-time/full-time) with no participants, the chip and
                    minute above are the whole card; the raw description is the
                    fallback only for a VAR/unknown moment, where it is the sole
                    information. */}
                {(() => {
                  const who = event.participants.map(localize).join(" · ");
                  const team = event.teamId ? teamNames?.[event.teamId] : undefined;
                  const showSentence = !who && event.type === "var";
                  return (
                    <>
                      {who || showSentence ? (
                        <p className="mt-2 text-sm font-bold text-ink" dir="auto">
                          {who || <bdi>{event.description}</bdi>}
                        </p>
                      ) : null}
                      {team ? (
                        <p className="mt-1 text-xs text-ink-2">
                          <bdi>{team}</bdi>
                        </p>
                      ) : null}
                    </>
                  );
                })()}
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
