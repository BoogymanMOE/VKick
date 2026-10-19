import { Fragment, useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Comment, TimelineEvent } from "../types";
import { useI18n } from "../i18n/context";
import type { StringKey } from "../i18n/strings";
import { BallIcon, CardIcon, SwapIcon } from "./icons";
import { cx } from "../lib/cx";
import { formatScore, runningScore } from "../lib/timelineScore";
import { Chip, Num, type ChipTone } from "./ui";

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
 * The mark inside an event's marker on the rail — drawn, never emoji. A
 * full-colour emoji ignores currentColor, renders differently on every
 * platform and breaks the one-meaning-per-colour rule (design-system.md §3),
 * so colour does the work the emoji would have: a goal is --volt, a booking
 * --gold, a sending-off --danger.
 */
function eventMark(
  type: TimelineEvent["type"],
  description: string,
): { glyph: ReactNode; tone: string } {
  const isRedCard = /\bred card\b|second yellow/i.test(description);
  switch (type) {
    case "goal":
      return {
        glyph: <BallIcon className="h-4 w-4" strokeWidth={2} />,
        tone:
          "border-volt bg-[color-mix(in_srgb,var(--volt)_18%,var(--bg-elevated))] text-volt",
      };
    case "card":
      // ESPN folds a red — including a second yellow — into `card`, so its text
      // is the only signal that the booking emptied the pitch.
      return {
        glyph: <CardIcon className="h-4 w-4" />,
        tone: isRedCard
          ? "border-danger bg-[color-mix(in_srgb,var(--live)_18%,var(--bg-elevated))] text-danger"
          : "border-gold bg-[color-mix(in_srgb,var(--gold)_18%,var(--bg-elevated))] text-gold",
      };
    case "substitution":
      return { glyph: <SwapIcon className="h-4 w-4" />, tone: "border-line bg-elevated text-ink-2" };
    case "var":
      return { glyph: "◇", tone: "border-line bg-elevated text-ink-2" };
    case "kickoff":
      return { glyph: "•", tone: "border-line bg-elevated text-ink-2" };
    case "halftime":
      return { glyph: "‖", tone: "border-line bg-elevated text-ink-2" };
    case "fulltime":
      return { glyph: "■", tone: "border-line bg-elevated text-ink-2" };
    case "other":
      return { glyph: "·", tone: "border-line bg-elevated text-ink-3" };
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

  const latestSeconds =
    liveMinute === undefined
      ? null
      : Math.max(...events.map((e) => e.minuteSeconds), 0);
  const openClip = (comment: Comment) =>
    onOpenClip ? onOpenClip(comment) : undefined;

  // "Goal — Cole Palmer" on its own never said what the goal DID to the match.
  // The score beside each goal is a prefix count of the timeline's own goals,
  // credited to the side each event names (src/lib/timelineScore.ts), so a
  // goal reads "1–0" the moment it lands rather than leaving the reader to
  // scroll up to the scoreboard.
  const { byGoal } = useMemo(
    () => runningScore(events, homeTeamId ?? "", awayTeamId ?? ""),
    [events, homeTeamId, awayTeamId],
  );

  // --- pre-pass: find the halftime event + the score at half time ---
  // The divider shows the score as it stood at half time (last goal in the
  // first half). If there is no halftime event, or no goals before it, the
  // label just reads "Half time" with a 0–0 scoreline.
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

  // --- pre-pass: cluster same-minute events (FIX 9) ---
  const currentCluster: Set<string> = new Set();
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    const prev = events[i - 1];
    const next = events[i + 1];
    if (
      (prev && prev.minuteDisplay === e.minuteDisplay) ||
      (next && next.minuteDisplay === e.minuteDisplay)
    ) {
      currentCluster.add(e.id);
    }
  }

  return (
    <ol className="relative space-y-3 ps-10">
      {/* Vertical timeline rail, one continuous line the markers sit on. */}
      <span
        className="absolute inset-y-1 start-[13px] w-0.5"
        style={{
          background: "linear-gradient(180deg, transparent 0%, var(--border-subtle) 8%, var(--border-subtle) 92%, transparent 100%)",
        }}
        aria-hidden="true"
      />

      {events.map((event, index) => {
        const isGoal = event.type === "goal";
        const isStructural =
          event.type === "kickoff" ||
          event.type === "halftime" ||
          event.type === "fulltime";
        const goalScore = byGoal.get(event.id);
        const mark = eventMark(event.type, event.description);
        const club = event.teamId ? teamColor?.[event.teamId] : undefined;
        const isNewestLive =
          latestSeconds !== null &&
          event.minuteSeconds === latestSeconds &&
          liveMinute !== undefined;
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

        // Card type, for both the tint and the accent edge: ESPN folds a red
        // (including a second yellow) into `card`, so its text is the signal.
        const redCard =
          event.type === "card" && /\bred card\b|second yellow/i.test(event.description);
        // Subtle fill that lets the timeline read as coloured bands instead of
        // a monochrome list: a goal washes volt, a booking washes gold (or the
        // sending-off's red), a substitution keeps only its neutral edge, and
        // breaks (VAR/halftime/fulltime) stay quiet. The wash is additive —
        // icon, minute and text are untouched. `border-s-*` is the logical
        // property, so the accent flips to the right side in the FA layout.
        const tinted =
          event.type === "goal" || event.type === "card" || event.type === "substitution";
        const tint =
          event.type === "goal"
            ? "color-mix(in srgb, var(--volt) 8%, transparent)"
            : event.type === "card"
              ? `color-mix(in srgb, var(--${redCard ? "live" : "gold"}) 8%, transparent)`
              : undefined;

        // --- live-edge helpers (FIX 8) ---
        // Both the marker `tone` and the card's own `edge` are allowed to keep
        // their own colour on a live card. The only thing that has to BE the
        // live colour is the persistent ring + glow on the card, plus the pulse
        // on the marker.
        const edge: string =
          event.type === "goal"
            ? isNewestLive
              ? ""
              : "border-s-[3px] border-s-volt"
            : event.type === "card"
              ? isNewestLive
                ? ""
                : redCard
                  ? "border-s-[3px] border-s-danger"
                  : "border-s-[3px] border-s-gold"
              : event.type === "substitution"
                ? isNewestLive
                  ? ""
                  : "border-s-[3px] border-s-line"
                : "";

        // --- cardtone + description (FIX 7 + FIX 5) ---
        const chipTone: ChipTone =
          isGoal
            ? "volt"
            : event.type === "card"
              ? redCard
                ? "live"
                : "gold"
              : event.type === "substitution"
                ? "muted"
                : event.type === "var"
                  ? "muted"
                  : event.type === "kickoff"
                    ? "muted"
                    : event.type === "halftime"
                      ? "muted"
                      : event.type === "fulltime"
                        ? "muted"
                        : "muted";

        // --- clustering band (FIX 9) ---
        // Two (or more) events sharing the same `minute_display` read as "this
        // minute was busy". The band is only applied when at least one sibling
        // shares the minute — an isolated event stays on the bare rail.
        const clustered = currentCluster.has(event.id);

        return (
          <Fragment key={event.id}>
            {event.type === "halftime" ? (
              <li className="relative my-3 text-center">
                <span className="relative z-10 inline-block px-3 py-1 rounded-full border border-line bg-base text-[10px] font-bold uppercase tracking-wide text-ink-3">
                  {t("timeline.halftime")} · {formatScore(halftimeScore)}
                </span>
                <span className="absolute inset-y-1/2 left-0 right-0 h-px bg-line" aria-hidden="true" />
              </li>
            ) : (
              <li
                className={cx(
                  "timeline-in relative",
                  clustered && "rounded-e-card bg-[color-mix(in_srgb,var(--bg-surface)_50%,transparent)] ps-2 -me-2",
                )}
                style={{ "--stagger": `${Math.min(index, 8) * 40}ms` } as CSSProperties}
              >
                {/* Marker on the rail: the event's mark over a wash of the club
                    that caused it. Halftimes and finals have no club, so they
                    keep the quiet elevated fill. */}
                <span
                  className={cx(
                    "absolute -start-10 top-2.5 grid h-8 w-8 place-items-center rounded-full border-2 bg-elevated",
                    mark.tone,
                    isNewestLive && "timeline-live-pulse",
                  )}
                  style={
                    club
                      ? { backgroundColor: `color-mix(in srgb, ${club} 18%, var(--bg-elevated))` }
                      : undefined
                  }
                  aria-hidden="true"
                >
                  {mark.glyph}
                </span>

                <div
                  className={cx(
                    "rounded-card border border-line bg-surface p-3",
                    isStructural
                      ? "border-dashed border-line bg-transparent"
                      : "border-line",
                    isGoal && "border-s-[3px] border-s-volt",
                    tinted && !isGoal && "border-s-[3px]",
                    tinted && edge,
                    isNewestLive && "live-edge",
                  )}
                  style={tint ? { background: tint } : undefined}
                >
                  <div className="flex items-center gap-2">
                    <Num className="grid h-6 min-w-[38px] place-items-center rounded-md border border-line bg-elevated px-1 text-[11px] text-ink-2">
                      {event.minuteDisplay}
                    </Num>
                    <Chip tone={chipTone}>{t(typeKey[event.type])}</Chip>
                    {/* The scoreline this goal produced. Always home–away, so the
                        number reads the same whichever side scored it. */}
                    {goalScore ? (
                      <Num className="ms-auto rounded-md bg-[color-mix(in_srgb,var(--volt)_12%,transparent)] px-2 py-0.5 text-sm font-black text-volt">
                        {formatScore(goalScore)}
                      </Num>
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
                    if (event.type === "kickoff") {
                      // Kickoff carries no participants; render the description muted + small,
                      // not as the main bold line.
                      return (
                        <p className="mt-1 text-xs text-ink-2">
                          <bdi>{event.description}</bdi>
                        </p>
                      );
                    }
                    if (event.type === "fulltime") {
                      // Full time pairs the label with the final score when it is easy to
                      // derive from the timeline's own goals; otherwise just the label.
                      return (
                        <p className="mt-1 text-xs text-ink-2">
                          {t("timeline.fulltime")} · {formatScore(finalScore)}
                        </p>
                      );
                    }
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
                  <PinnedComment
                    key={comment.id}
                    comment={comment}
                    onOpenClip={openClip}
                  />
                ))}

                {/* Participant row — dot-separated so it reads cleanly in RTL. */}
                {event.participants.length > 0 ? (
                  <p className="mt-1 text-xs text-ink-2 flex items-center gap-1.5 flex-wrap">
                    {event.participants.map((p, i) => (
                      <span key={i} className="inline-flex items-center gap-1.5">
                        {localize(p)}
                        {i < event.participants.length - 1 && (
                          <span aria-hidden="true" className="inline-block h-1 w-1 rounded-full bg-ink-3 opacity-50" />
                        )}
                      </span>
                    ))}
                  </p>
                ) : null}
              </li>
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}
