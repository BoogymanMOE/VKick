import { Fragment, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Comment, TimelineEvent } from "../types";
import { useI18n } from "../i18n/context";
import type { StringKey } from "../i18n/strings";
import { BallIcon, CardIcon, SwapIcon } from "./icons";
import { cx } from "../lib/cx";
import { toFaDigits } from "../lib/format";
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
  description: string,) : { glyph: ReactNode; className: string } {
  switch (type) {
    case "goal":
      return { glyph: <BallIcon className="h-4 w-4" />, className: "text-volt" };
    case "card":
      // The booking reads at a glance as the actual card: a filled rounded
      // rectangle — yellow, red, or yellow-in-front-of-red (a second yellow
      // turning). The stroke icon stays for the booking kinds the feed
      // describes neither way (rare).
      return {
        glyph: cardGlyph(description),
        className: "",
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

/** The card itself, drawn: yellow, red, or the stacked yellow-over-red pair
 *  ESPN describes as a "second yellow". Falls back to the stroke icon when
 *  the description is too vague to pick a color. */
function cardGlyph(description: string): ReactNode {
  const isRed = /\bred card\b/i.test(description);
  const isSecondYellow = /second yellow/i.test(description);
  if (!isRed && !isSecondYellow) {
    if (!/yellow/i.test(description)) return <CardIcon className="h-4 w-4 text-gold" />;
    return <span aria-hidden="true" className="inline-block h-4 w-2.5 rounded-[2px] bg-gold shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" />;
  }
  if (isSecondYellow) {
    // Yellow-booked, then red: the pair overlaps — red behind, yellow front.
    return (
      <span aria-hidden="true" className="relative inline-block h-4 w-4">
        <span className="absolute inset-y-0 end-0 w-2.5 rounded-[2px] bg-danger shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" />
        <span className="absolute inset-y-0 start-0 w-2.5 rounded-[2px] bg-gold shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" />
      </span>
    );
  }
  return <span aria-hidden="true" className="inline-block h-4 w-2.5 rounded-[2px] bg-danger shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" />;
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
          className="grid h-6 w-6 flex-none place-items-center rounded-full border border-line bg-surface text-xs font-extrabold text-ink-2"
          aria-hidden="true"
        >
          {(comment.isMine ? t("comments.you") : comment.author).slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-bold text-ink-2">
          {comment.isMine ? t("comments.you") : comment.author}
        </span>
        {comment.mediaLink ? (
          <button
            type="button"
            onClick={() => onOpenClip(comment)}
            className="flex-none text-xs font-bold text-volt underline-offset-2 hover:underline"
          >
            {t("comments.attachOpen")} ↗
          </button>
        ) : null}
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-ink">{localize(comment.text)}</p>
    </div>
  );
}

/**
 * The two spine cells. Both wrap (never truncate) and render: bold name, the
 * second line under it, and the icon pinned to the spine edge. A goal gets a
 * volt-tinted cell so it reads at a glance. Children = the comment trigger.
 */
function EventBody({ name, line2 }: { name: ReactNode; line2: ReactNode }) {
  return name ? (
    <span className="min-w-0 text-start" dir="auto">
      <span className="block text-sm font-bold text-ink">{name}</span>
      {line2 ? (
        <span className="block text-xs text-ink-3">{line2}</span>
      ) : null}
    </span>
  ) : null;
}

function HomeSpineCell({
  parts,
  goal,
  children,
}: {
  parts: { icon: { glyph: ReactNode; className: string }; name: ReactNode; line2: ReactNode };
  goal: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cx(
        "col-start-1 row-start-1 -me-2 flex min-w-0 items-center justify-end gap-2",
        goal && "rounded-card border border-volt/30 bg-elevated px-2 py-1",
      )}
    >
      {children}
      <EventBody name={parts.name} line2={parts.line2} />
      <span aria-hidden="true" className={cx("flex-none", parts.icon.className)}>
        {parts.icon.glyph}
      </span>
    </div>
  );
}

function AwaySpineCell({
  parts,
  goal,
  children,
}: {
  parts: { icon: { glyph: ReactNode; className: string }; name: ReactNode; line2: ReactNode };
  goal: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cx(
        "col-start-3 row-start-1 -ms-2 flex min-w-0 items-center justify-start gap-2",
        goal && "rounded-card border border-volt/30 bg-elevated px-2 py-1",
      )}
    >
      <span aria-hidden="true" className={cx("flex-none", parts.icon.className)}>
        {parts.icon.glyph}
      </span>
      <EventBody name={parts.name} line2={parts.line2} />
      {children}
    </div>
  );
}

/**
 * A timeline with a CENTER SPINE: minutes live in the middle column, home-team
 * events hang on the home side of it (the home column — start edge in both
 * directions, matching the home-first scoreboard), away events on the other.
 * Each event cell hugs the spine: text reads toward the minute it happened at.
 * Names never truncate — they wrap.
 */
export function TimelineList({
  events,
  comments = [],
  liveMinute,
  onOpenClip,
  homeTeamId,
  awayTeamId,
}: {
  events: TimelineEvent[];
  /** Pinned crowd comments, opened from the event row that owns them. */
  comments?: Comment[];
  liveMinute?: number;
  /** Handler for opening a comment's clip link (validated https by the server). */
  onOpenClip?: (comment: Comment) => void;
  /** The match's two sides: the event's teamId picks ITS column. */
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
  // scroll up to the scoreboard. Displayed UNDER the event's minute, so the
  // center spine shows when AND what the score became.
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

  /** Digits through locale conversion: Persian-Indic glyphs under FA, Latin
      under EN (toFaDigits passes non-digits through untouched). */
  const digits = (value: string) => (dir === "rtl" ? toFaDigits(value) : value);

  /** Comment-thread trigger shared by event rows and the HT/FT separators:
      36px visual with an invisible 44px+ hit band (the same pattern as the
      feed's league chips). */
  const commentTrigger = (eventId: string, count: number) => {
    const commentsOpen = openCommentsId === eventId;
    return (
      <button
        type="button"
        aria-expanded={commentsOpen}
        onClick={() => setOpenCommentsId(commentsOpen ? null : eventId)}
        className="relative inline-flex h-9 flex-none items-center gap-1 rounded-lg px-2 text-xs font-bold text-gold after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-['']"
      >
        <span aria-hidden="true">💬</span>
        <Num>{count}</Num>
        <span className="sr-only">{t("comments.liveThread")}</span>
      </button>
    );
  };

  /** The event parts the side cells render: icon, bold name, second line
      (assist / swap partner / card kind). No English feed sentence in the FA
      page — the event kind is localized here, names come through the person
      map with the English fallback, and neither ever truncates. */
  function eventParts(event: TimelineEvent): {
    icon: { glyph: ReactNode; className: string };
    name: ReactNode;
    line2: ReactNode;
  } {
    const icon = eventIcon(event.type, event.description);
    const names = event.participants.map(localize);
    const [first, second] = names;
    let name: ReactNode = first ?? "";

    // Second line: what the FIRST name did with the second one. Own goal
    // wins over the assist branch — with two participants (keeper whose
    // deflection went in, etc.) calling the second name an assist would be
    // flatly wrong, so the own-goal test must run first.
    let line2: ReactNode = null;
    if (event.type === "goal" && /\bown goal\b/i.test(event.description)) {
      line2 = t("timeline.ownGoal");
    } else if (event.type === "goal" && second) {
      line2 = t("timeline.assist", { name: second });
    } else if (event.type === "card") {
      line2 = t(
        /\bred card\b|second yellow/i.test(event.description)
          ? "timeline.red"
          : /yellow/i.test(event.description)
            ? "timeline.yellow"
            : "timeline.card",
      );
    } else if (event.type === "substitution" && second) {
      // ESPN's documented sub order (server/espn/normalize.ts, and relied on
      // by findSubMinute): participants[0] came ON, [1] went OFF. Render the
      // direction explicitly instead of the ambiguous swap glyph: a volt ▲
      // beside the on-player's name, a danger ▼ with the off-player below.
      name = (
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="font-bold text-volt">▲</span>
          {first}
        </span>
      );
      line2 = (
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="font-bold text-danger">▼</span>
          {second}
        </span>
      );
    } else if (!first) {
      line2 = t(typeKey[event.type]);
    }
    return { icon, name, line2 };
  }

  // Shared grid: side cells flex, fixed center for the minute (+ the score a
  // goal produced, directly under its minute).
  const SPINE_GRID = "grid grid-cols-[minmax(0,1fr)_56px_minmax(0,1fr)] items-center gap-2 px-1";

  return (
    <ol className="relative">
      {/* Live-minute indicator: a slim status row at the top, replaced by real
          events as they land. The dot is the shared --live pulse. */}
      {liveMinute !== undefined ? (
        <li
          role="status"
          className="flex items-center gap-2 px-1 py-1 text-xs font-bold text-live"
        >
          <LiveDot />
          <span>{t("status.live")}</span>
          <span dir="ltr">
            <Num>{digits(String(liveMinute))}′</Num>
          </span>
        </li>
      ) : null}

      {events.map((event, index) => {
        const isGoal = event.type === "goal";
        const isSeparator = event.type === "halftime" || event.type === "fulltime";
        const goalScore = byGoal.get(event.id);
        const side: "home" | "away" | null =
          event.teamId == null
            ? null
            : event.teamId === homeTeamId
              ? "home"
              : "away";
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
                {/* Home–away and LTR, so the numbers read home-first in both
                    directions — Persian digits still read left-to-right. */}
                <span dir="ltr" className="text-ink-2">
                  <Num>{digits(score)}</Num>
                </span>
                {count > 0 ? commentTrigger(event.id, count) : null}
              </span>
              <span className="h-px flex-1 bg-line" aria-hidden="true" />
            </li>
          );
        }

        // No side (kickoff): a small centered note carrying the minute.
        if (side === null) {
          return (
            <li
              key={event.id}
              className="flex items-center justify-center gap-2 py-1.5 text-xs text-ink-3"
            >
              <span dir="ltr" className="text-sm font-extrabold text-ink-2">
                <Num>{digits(event.minuteDisplay)}</Num>
              </span>
              <span>{t(typeKey[event.type])}</span>
              {count > 0 ? commentTrigger(event.id, count) : null}
            </li>
          );
        }

        return (
          <Fragment key={event.id}>
            <li className={cx(SPINE_GRID, index === 0 ? "pt-2" : "py-2")}>
              {/* MINUTE — the middle of the spine. Persian digits under FA. */}
              <span className="flex flex-col items-center gap-0.5">
                <span dir="ltr" className="text-sm font-extrabold text-ink-2">
                  <Num>{digits(event.minuteDisplay)}</Num>
                </span>
                {/* The scoreline this goal produced: under its own minute. */}
                {isGoal && goalScore ? (
                  <span dir="ltr">
                    <Num className="text-xs font-extrabold text-volt">
                      {digits(formatScore(goalScore))}
                    </Num>
                  </span>
                ) : null}
              </span>

              {/* HOME — first column, content hugging the spine (its END edge
                  in both directions): trigger, text, icon-at-spine. */}
              {side === "home" ? (
                <HomeSpineCell parts={eventParts(event)} goal={isGoal}>
                  {count > 0 ? commentTrigger(event.id, count) : null}
                </HomeSpineCell>
              ) : (
                <span aria-hidden="true" className="col-start-1 row-start-1" />
              )}

              {/* AWAY — third column, content hugging the spine: icon-at-spine,
                  text, trigger. */}
              {side === "away" ? (
                <AwaySpineCell parts={eventParts(event)} goal={isGoal}>
                  {count > 0 ? commentTrigger(event.id, count) : null}
                </AwaySpineCell>
              ) : (
                <span aria-hidden="true" className="col-start-3 row-start-1" />
              )}
            </li>

            {/* The row's comment thread, once opened. Substitution direction is
                shown in the name pair, so the icon swap is cosmetic-only
                below. */}
            {commentsOpen ? (
              <li className="px-1 pb-2">
                {/* The composer is intentionally unmounted for now, so the
                    thread must SAY it is view-only: a thread the user can
                    open but never answer otherwise reads as a broken form. */}
                <p role="note" className="mb-1 text-xs leading-relaxed text-ink-3">
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
