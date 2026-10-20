import { Fragment, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Comment, TimelineEvent } from "../types";
import { useI18n } from "../i18n/context";
import type { StringKey } from "../i18n/strings";
import { BallIcon, CardIcon, SwapIcon } from "./icons";
import { cx } from "../lib/cx";
import { formatScore, runningScore } from "../lib/timelineScore";
import { LiveDot, Num } from "./ui";

const typeKey: Record<TimelineEvent["type"], StringKey> = {
  goal: "timeline.goal",
  card: "timeline.card",
  substitution: "timeline.sub",
  var: "timeline.var",
  kickoff: "timeline.kickoff",
  halftime: "timeline.halftime",
  fulltime: "timeline.fulltime",
  other: "timeline.other",
};

/**
 * The 16px event icon (design-system "drawn, never emoji"): a goal is the ball
 * in --volt, a booking --gold (or --danger for a sending-off — ESPN folds a
 * red, including a second yellow, into the `card` type, so the description is
 * the only signal).
 */
function eventIcon(
  type: TimelineEvent["type"],
  description: string,
): { glyph: ReactNode; className: string } {
  const isRedCard = /\bred card\b|second yellow/i.test(description);
  switch (type) {
    case "goal":
      return { glyph: <BallIcon className="h-4 w-4" />, className: "text-volt" };
    case "card":
      return {
        glyph: <CardIcon className="h-4 w-4" />,
        className: isRedCard ? "text-danger" : "text-gold",
      };
    case "substitution":
      return { glyph: <SwapIcon className="h-4 w-4" />, className: "text-ink-2" };
    case "var":
      return { glyph: "◇", className: "text-ink-3" };
    case "kickoff":
      return { glyph: "•", className: "text-ink-3" };
    case "other":
      return { glyph: "·", className: "text-ink-3" };
    default:
      return { glyph: "·", className: "text-ink-3" };
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
        "mt-1 rounded-card border p-2.5",
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
  /** Pinned crowd comments, opened from the event row that owns them. */
  comments?: Comment[];
  liveMinute?: number;
  /** Handler for opening a comment's clip link (validated https by the server). */
  onOpenClip?: (comment: Comment) => void;
  /**
   * teamId → club colour. The 8px dot beside the player names the side, so a
   * two-column read of who did what needs no names.
   */
  teamColor?: Record<string, string>;
  /**
   * teamId → localized club name. A row names the player(s) and the side, not
   * the English sentence the feed carries ("… Yellow Card at 12'"), which in a
   * Persian page scrambles the bidi run and repeats the player name.
   */
  teamNames?: Record<string, string>;
  /** The match's two sides, so a goal can carry the scoreline it produced. */
  homeTeamId?: string;
  awayTeamId?: string;
}) {
  const { t, localize, dir } = useI18n();
  // Which event's comment thread is expanded — only rows with comments carry
  // the trigger, so only those rows ever grow.
  const [openCommentsId, setOpenCommentsId] = useState<string | null>(null);

  const openClip = (comment: Comment) =>
    onOpenClip ? onOpenClip(comment) : undefined;

  // The score beside each goal is a prefix count of the timeline's own goals,
  // credited to the side each event names (src/lib/timelineScore.ts), so a
  // goal reads "1–0" the moment it lands rather than leaving the reader to
  // scroll up to the scoreboard.
  const { byGoal } = useMemo(
    () => runningScore(events, homeTeamId ?? "", awayTeamId ?? ""),
    [events, homeTeamId, awayTeamId],
  );

  // --- pre-pass: find the halftime event + the score at half time ---
  const halftimeEvent = events.find((e) => e.type === "halftime") ?? null;
  const halftimeScore = useMemo(() => {
    if (!halftimeEvent) return { home: 0, away: 0 };
    let lastGoalId: string | null = null;
    for (const e of events) {
      if (e.type === "goal" && e.minuteSeconds < halftimeEvent.minuteSeconds) {
        lastGoalId = e.id;
      }
    }
    return lastGoalId
      ? (byGoal.get(lastGoalId) ?? { home: 0, away: 0 })
      : { home: 0, away: 0 };
  }, [events, halftimeEvent, byGoal]);

  // --- pre-pass: final score (for the full-time line) ---
  const finalScore = useMemo(() => {
    const vals = [...byGoal.values()];
    return vals.length > 0 ? vals[vals.length - 1]! : { home: 0, away: 0 };
  }, [byGoal]);

  // Shared grid for a compact event row: minute | 16px icon | player(s) | right
  // slot (running score for goals, comment count for rows that have them).
  const ROW_GRID =
    "grid min-h-12 grid-cols-[40px_20px_minmax(0,1fr)_auto] items-center gap-2 px-1 py-2";

  return (
    <ol>
      {/* Live-minute indicator: a slim status row at the top, replaced by real
          events as they land. The dot is the shared --live pulse. */}
      {liveMinute !== undefined ? (
        <li
          role="status"
          className="flex items-center gap-2 px-1 py-1 text-xs font-bold text-[color:var(--live)]"
        >
          <LiveDot />
          <span>{t("status.live")}</span>
          <span dir="ltr">
            <Num>{liveMinute}'</Num>
          </span>
        </li>
      ) : null}

      {events.map((event, index) => {
        const isGoal = event.type === "goal";
        const isSeparator = event.type === "halftime" || event.type === "fulltime";
        const goalScore = byGoal.get(event.id);
        const icon = eventIcon(event.type, event.description);
        const club = event.teamId ? teamColor?.[event.teamId] : undefined;
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
        const commentsOpen = openCommentsId === event.id;

        // Half-time and full-time are not rows: a centred divider with the
        // score as it stood at that moment.
        if (isSeparator) {
          const label = t(typeKey[event.type]);
          const score =
            event.type === "halftime" ? formatScore(halftimeScore) : formatScore(finalScore);
          return (
            <li
              key={event.id}
              role="separator"
              aria-label={
                count > 0 ? `${label} · ${t("comments.liveThread")}: ${count}` : label
              }
              className="my-2 flex items-center gap-3 text-xs font-bold text-ink-3"
            >
              <span className="h-px flex-1 bg-line" aria-hidden="true" />
              <span className="flex items-center gap-2">
                <span>{label}</span>
                <span dir="ltr" className="text-ink-2">
                  <Num>{score}</Num>
                </span>
                {count > 0 ? (
                  <button
                    type="button"
                    aria-expanded={commentsOpen}
                    onClick={() => setOpenCommentsId(commentsOpen ? null : event.id)}
                    // 36px visual with an invisible 44px+ hit band (the same
                    // pattern as the feed's league chips): a full 44px visual
                    // control would balloon the row past the compact band.
                    className="relative inline-flex h-9 items-center gap-1 rounded-full px-2 text-xs font-bold text-gold after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-['']"
                  >
                    <span aria-hidden="true">💬</span>
                    <Num>{count}</Num>
                    <span className="sr-only">{t("comments.liveThread")}</span>
                  </button>
                ) : null}
              </span>
              <span className="h-px flex-1 bg-line" aria-hidden="true" />
            </li>
          );
        }

        const who = event.participants.map(localize).join(" · ");
        const team = event.teamId ? teamNames?.[event.teamId] : undefined;

        return (
          <Fragment key={event.id}>
            <li
              className={cx(
                ROW_GRID,
                isGoal
                  ? "my-1 rounded-card border border-volt/30 bg-elevated"
                  : "border-b border-line",
              )}
            >
              {/* The minute reads LTR everywhere — digits plus an apostrophe
                  would mirror into Arabic-script order otherwise. */}
              <span dir="ltr" className="text-center text-sm font-extrabold text-ink-2">
                <Num>{event.minuteDisplay}</Num>
              </span>
              <span
                aria-hidden="true"
                className={cx("grid place-items-center", icon.className)}
                // The substitution arrows read as "off → on" in LTR; mirror
                // them in RTL so they keep reading against the text flow.
                style={
                  event.type === "substitution" && dir === "rtl"
                    ? { transform: "scaleX(-1)" }
                    : undefined
                }
              >
                {icon.glyph}
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  {club ? (
                    <span
                      className="h-2 w-2 flex-none rounded-full ring-1 ring-ink-3"
                      style={{ backgroundColor: club }}
                      aria-hidden="true"
                    />
                  ) : null}
                  <span
                    className="truncate text-sm font-bold text-ink"
                    dir="auto"
                    title={count > 0 ? t(typeKey[event.type]) : undefined}
                  >
                    {who || <bdi>{event.description}</bdi>}
                  </span>
                </span>
                {team ? (
                  <span className="block truncate text-xs text-ink-3">
                    <bdi>{team}</bdi>
                  </span>
                ) : null}
              </span>
              <span className="flex items-center justify-end gap-2 text-end">
                {/* The scoreline this goal produced. Always home–away and LTR,
                    so the number reads the same whichever side scored it. */}
                {isGoal && goalScore ? (
                  <span dir="ltr">
                    <Num className="text-sm font-extrabold text-volt">
                      {formatScore(goalScore)}
                    </Num>
                  </span>
                ) : null}
                {/* The crowd thread trigger lives in the same row — 44px tall,
                    and rendered only on rows that actually have comments. */}
                {count > 0 ? (
                  <button
                    type="button"
                    aria-expanded={commentsOpen}
                    onClick={() => setOpenCommentsId(commentsOpen ? null : event.id)}
                    // 36px visual with an invisible 44px+ hit band (the same
                    // pattern as the feed's league chips): a full 44px visual
                    // control would balloon the row past the compact band.
                    className="relative inline-flex h-9 items-center gap-1 rounded-full px-2 text-xs font-bold text-gold after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-['']"
                  >
                    <span aria-hidden="true">💬</span>
                    <Num>{count}</Num>
                    <span className="sr-only">{t("comments.liveThread")}</span>
                  </button>
                ) : null}
              </span>
            </li>

            {/* The row's comment thread, once opened. Substitution arrows note
                their direction explicitly in the name pair, so the icon swap is
                cosmetic-only below. */}
            {commentsOpen ? (
              <li className="px-1 pb-2">
                {/* The composer is intentionally unmounted for now, so the
                    thread must SAY it is view-only: a thread the user can
                    open but never answer otherwise reads as a broken form. */}
                <p role="note" className="mb-1 text-[11px] leading-relaxed text-ink-3">
                  {t("comments.readOnly")}
                </p>
                <ul>
                  {pinned.map((comment) => (
                    <li key={comment.id}>
                      <PinnedComment comment={comment} onOpenClip={openClip} />
                    </li>
                  ))}
                </ul>
              </li>
            ) : null}
          </Fragment>
        );
      })}
    </ol>
  );
}
