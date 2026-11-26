import { Link } from "react-router-dom";
import type { BracketRound, BracketTie } from "../lib/bracket";
import { useI18n } from "../i18n/context";
import { TeamBadge } from "./ui";
import { cx } from "../lib/cx";
import { formatKickoffShort } from "../lib/format";
import type { Match, Team } from "../types";

/**
 * The knockout board: one column per round, early rounds on the left, the
 * final on the right, with curved connectors drawn from each feeder tie to
 * the tie it produced. Every tie is a fixed-size card so the columns line up
 * without measuring the DOM; the whole board scrolls sideways on a phone.
 *
 * Geometry is pure arithmetic (round index × column width, tie index × slot
 * height), which is also what lets the connector paths be drawn in one SVG
 * pass — no ResizeObserver, no layout thrash on a low-end webview.
 */
const CARD_W = 186;
const CARD_H = 68;
const SLOT = 84;
const GAP = 46;
const HEADER_H = 30;

export function CupBracket({ rounds }: { rounds: BracketRound[] }) {
  const { t, localize, lang } = useI18n();
  const locale = lang === "fa" ? "fa-IR" : lang === "de" ? "de-DE" : undefined;

  // The tallest round decides the board height; shorter rounds centre their
  // ties across the same field, which is what makes the tree line up.
  const maxTies = Math.max(1, ...rounds.map((round) => round.ties.length));
  const boardH = HEADER_H + maxTies * SLOT;
  const boardW = rounds.length * CARD_W + (rounds.length - 1) * GAP;
  const colX = (index: number) => index * (CARD_W + GAP);

  // Tie key → its card's centre. Connectors use these, so a tie fed by two
  // earlier rounds curves back to both instead of assuming a neat pairing.
  const centres = new Map<string, { x: number; y: number }>();
  rounds.forEach((round, roundIndex) => {
    const slot = (maxTies * SLOT) / round.ties.length;
    round.ties.forEach((tie, tieIndex) => {
      centres.set(tie.key, {
        x: colX(roundIndex) + CARD_W / 2,
        y: HEADER_H + (tieIndex + 0.5) * slot,
      });
    });
  });

  return (
    <div className="mt-3">
      <div
        // LTR on purpose: a bracket reads as a left-to-right tree in both
        // languages; names and round labels still render with `dir="auto"`.
        dir="ltr"
        className="overflow-x-auto overscroll-x-contain rounded-card border border-line bg-base/40 p-2"
        role="group"
        aria-label={t("cups.bracket")}
      >
        <div className="relative" style={{ width: boardW, height: boardH }}>
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            width={boardW}
            height={boardH}
          >
            {rounds.map((round, roundIndex) =>
              roundIndex === 0
                ? null
                : round.ties.flatMap((tie) =>
                    tie.feeds.map((feederKey) => {
                      const from = centres.get(feederKey);
                      const to = centres.get(tie.key);
                      if (!from || !to) return null;
                      const x1 = from.x + CARD_W / 2;
                      const x2 = to.x - CARD_W / 2;
                      const mid = (x1 + x2) / 2;
                      return (
                        <path
                          key={`${feederKey}->${tie.key}`}
                          d={`M ${x1} ${from.y} C ${mid} ${from.y}, ${mid} ${to.y}, ${x2} ${to.y}`}
                          fill="none"
                          stroke="var(--line)"
                          strokeWidth={1.5}
                        />
                      );
                    }),
                  ),
            )}
          </svg>

          {rounds.map((round, roundIndex) => (
            <h3
              key={round.label}
              dir="auto"
              className="absolute truncate text-center text-[10px] font-extrabold uppercase tracking-wide text-ink-2"
              style={{ left: colX(roundIndex), top: 4, width: CARD_W }}
            >
              {localize(round.label)}
            </h3>
          ))}

          {rounds.map((round, roundIndex) =>
            round.ties.map((tie) => {
              const centre = centres.get(tie.key)!;
              return (
                <TieNode
                  key={tie.key}
                  tie={tie}
                  locale={locale}
                  left={colX(roundIndex)}
                  top={centre.y - CARD_H / 2}
                />
              );
            }),
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-ink-3">{t("cups.bracketHint")}</p>
    </div>
  );
}

function TieNode({
  tie,
  left,
  top,
  locale,
}: {
  tie: BracketTie;
  left: number;
  top: number;
  locale?: string;
}) {
  const { t, localize } = useI18n();
  const twoLegs = tie.legs.length > 1;
  const openLeg = tie.legs.find((leg) => leg.status !== "finished") ?? tie.legs[tie.legs.length - 1];
  const scheduled = openLeg?.status === "scheduled";

  // Oriented home/away of the first leg; a two-legged tie reads as its
  // aggregate, a one-legged tie as that match's score.
  const homeScore = twoLegs ? tie.aggHome : tie.legs[0]?.homeScore;
  const awayScore = twoLegs ? tie.aggAway : tie.legs[0]?.awayScore;
  const homePens = twoLegs ? tie.aggHomePens : tie.legs[0]?.homePens;
  const awayPens = twoLegs ? tie.aggAwayPens : tie.legs[0]?.awayPens;

  const home = findTeam(tie.legs, tie.homeId);
  const away = findTeam(tie.legs, tie.awayId);

  const label = twoLegs
    ? `${tie.homeName} ${t("common.versus")} ${tie.awayName}, ${t("cups.tieAgg")} ${tie.aggHome ?? "–"}–${tie.aggAway ?? "–"}`
    : `${tie.homeName} ${t("common.versus")} ${tie.awayName}`;

  return (
    <Link
      to={`/match/${openLeg.id}`}
      aria-label={label}
      className={cx(
        "absolute flex flex-col justify-center gap-1 rounded-xl border bg-surface px-2.5 py-1.5 shadow-[0_1px_0_rgba(0,0,0,0.18)] transition-[background-color,border-color,transform] duration-[var(--t-fast)]",
        "hover:bg-elevated active:scale-[0.985]",
        tie.winnerId ? "border-volt/45" : "border-line",
      )}
      style={{ left, top, width: CARD_W, height: CARD_H }}
      dir="ltr"
    >
      <TeamLine
        team={home}
        name={tie.homeName}
        score={homeScore}
        pens={homePens}
        winner={tie.winnerId === tie.homeId}
        live={openLeg.status === "live"}
      />
      <TeamLine
        team={away}
        name={tie.awayName}
        score={awayScore}
        pens={awayPens}
        winner={tie.winnerId === tie.awayId}
        live={openLeg.status === "live"}
      />
      {scheduled ? (
        <span className="text-center text-[9px] font-bold leading-none text-ink-3">
          {formatKickoffShort(new Date(openLeg.kickoffAt), locale)}
        </span>
      ) : twoLegs ? (
        <span className="text-center text-[9px] font-bold uppercase leading-none tracking-wide text-ink-3">
          {t("cups.tieAgg")}
        </span>
      ) : null}
      {twoLegs ? (
        <span className="sr-only">
          {localize(tie.round)} · {t("cups.winnerAdvances")}
        </span>
      ) : null}
    </Link>
  );
}

function TeamLine({
  team,
  name,
  score,
  pens,
  winner,
  live,
}: {
  team: Team | null;
  name: string;
  score: number | null | undefined;
  pens: number | null | undefined;
  winner: boolean;
  live: boolean;
}) {
  const { localize } = useI18n();
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {team ? (
        <TeamBadge team={team} size="xs" />
      ) : (
        <span aria-hidden="true" className="h-[22px] w-[22px] flex-none rounded-full bg-elevated" />
      )}
      <span
        dir="auto"
        className={cx(
          "min-w-0 flex-1 truncate text-[11px] leading-tight",
          winner ? "font-extrabold text-ink" : "font-bold text-ink-2",
        )}
      >
        {localize(name)}
        {winner ? (
          <span aria-hidden="true" className="ms-1 inline-block h-1.5 w-1.5 rounded-full bg-volt align-middle" />
        ) : null}
      </span>
      <span
        className={cx(
          "flex flex-none items-center gap-0.5 text-[11px] tabular-nums",
          winner ? "font-extrabold text-volt" : "font-bold text-ink-2",
          live && "text-live",
        )}
      >
        {score ?? (pens != null ? "–" : "")}
        {pens != null ? <span className="text-[9px] text-ink-3">({pens})</span> : null}
      </span>
    </div>
  );
}

function findTeam(legs: Match[], id: string): Team | null {
  for (const leg of legs) {
    if (leg.home.id === id) return leg.home;
    if (leg.away.id === id) return leg.away;
  }
  return null;
}
