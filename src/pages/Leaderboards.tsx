import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { RulesButton } from "../components/RulesSheet";
import { ChartIcon, ChevronDownIcon } from "../components/icons";
import {
  Avatar,
  Chip,
  CountUp,
  EmptyState,
  ErrorState,
  Num,
  SectionHeading,
  Segmented,
} from "../components/ui";
import { cx } from "../lib/cx";
import { slugForLeague, useLeaderboard, useLeagueTabs, type LeaderboardScope } from "../hooks/useApi";
import { useFavorites } from "../hooks/useFavorites";
import { useI18n } from "../i18n/context";
import { scopeRankDelta, viewerStanding } from "../lib/leaderboard";

type BoardTab = "global" | "league" | "club";

/**
 * The stakes layer, made visible: season prediction points across the three
 * boards from the concept — global, per-league, per-club. Public by design;
 * ties resolved by first-to-reach (the server ranks, we render).
 *
 * A viewer ranked below the board's page limit gets an honest "you" row
 * appended under a divider (server-computed with the board's own tiebreak),
 * so rank 137 is a fact on screen instead of an absence.
 */
export default function Leaderboards() {
  const { t, localize } = useI18n();
  const { teams } = useFavorites();
  const [tab, setTab] = useState<BoardTab>("global");
  const [league, setLeague] = useState<string>("eng.1");
  const [clubId, setClubId] = useState<string>("");

  const scope: LeaderboardScope =
    tab === "league" ? { league } : tab === "club" && clubId ? { club: clubId } : "global";

  const board = useLeaderboard(scope);

  const rows = board.data?.board ?? [];
  const you = board.data?.you ?? null;
  // The viewer's own placing, whether they sit on the page or below it. It
  // leads the board as a summary: the stakes layer should answer "where do I
  // stand" before it answers "who else is here".
  const standing = viewerStanding(rows, you);

  // Session-scoped rank movement: the board refetches on window focus, so
  // comparing consecutive observations of the SAME scope gives an honest
  // ▲/▼ without a server field (scopeRankDelta in lib/leaderboard.ts — a
  // scope switch or a repeat observation at the same rank yields no chip).
  const scopeKey = JSON.stringify(scope);
  const prevObsRef = useRef<{ scope: string; rank: number } | null>(null);
  const [rankDelta, setRankDelta] = useState<number | null>(null);
  const standingRank = standing?.rank ?? null;
  useEffect(() => {
    if (standingRank === null) return;
    const delta = scopeRankDelta(prevObsRef.current, scopeKey, standingRank);
    prevObsRef.current = { scope: scopeKey, rank: standingRank };
    setRankDelta(delta);
  }, [standingRank, scopeKey]);

  return (
    <>
      <TopBar
        title={t("board.title")}
        subtitle={t("board.subtitle")}
        right={
          <div className="flex flex-none items-center gap-2">
            {/* Ranks is where ranking-curious users land; Player Stats is the
                same instinct one layer over — season stat leaders — so it
                gets the navigation slot instead of a tab of its own. */}
            <Link
              to="/stats"
              aria-label={t("statsPage.title")}
              title={t("statsPage.title")}
              className="grid h-11 w-11 flex-none place-items-center rounded-full border border-line text-ink-2 transition-colors duration-[var(--t-fast)] hover:bg-elevated hover:text-volt"
            >
              <ChartIcon />
            </Link>
            <RulesButton />
          </div>
        }
      />

      <div className="mt-3">
        <Segmented
          value={tab}
          onChange={(next) => setTab(next)}
          options={[
            { value: "global", label: t("board.global") },
            { value: "league", label: t("board.league") },
            { value: "club", label: t("board.club") },
          ]}
        />
      </div>

      {tab === "league" ? (
        <section className="mt-4">
          <SectionHeading title={t("board.pickLeague")} />
          <LeaguePicker value={league} onChange={setLeague} />
        </section>
      ) : null}

      {tab === "club" ? (
        <section className="mt-4">
          <SectionHeading title={t("board.pickClub")} />
          {teams.length > 0 ? (
            <ul className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
              {teams.map((team) => (
                <li key={team.id} className="flex-none">
                  <button
                    type="button"
                    onClick={() => setClubId(team.id)}
                    className={cx(
                      "flex w-[76px] flex-col items-center gap-1 rounded-card border p-2.5 text-center transition-[background-color,transform] duration-[var(--t-fast)] active:scale-[0.97]",
                      clubId === team.id
                        ? "border-volt bg-elevated"
                        : "border-line bg-surface hover:bg-elevated",
                    )}
                  >
                    <span
                      className="grid h-8 w-8 place-items-center rounded-full border text-[10px] font-extrabold"
                      style={{
                        borderColor: `color-mix(in srgb, ${team.color} 55%, transparent)`,
                        backgroundColor: `color-mix(in srgb, ${team.color} 18%, transparent)`,
                      }}
                      aria-hidden="true"
                    >
                      {team.abbreviation}
                    </span>
                    <span className="w-full truncate text-[11px] font-bold text-ink">
                      {localize(team.shortName)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-card border border-dashed border-line px-3 py-4 text-center text-xs text-ink-3">
              {t("table.noClubs")}
            </p>
          )}
        </section>
      ) : null}

      <section className="mt-4">
        {board.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="shimmer h-12 rounded-card border border-line" />
            ))}
          </div>
        ) : board.isError ? (
          <ErrorState onRetry={() => board.refetch()} />
        ) : tab === "club" && !clubId ? (
          <EmptyState title={t("board.pickClub")} hint={t("board.pickClubHint")} />
        ) : rows.length === 0 ? (
          <EmptyState title={t("board.empty")} hint={t("board.emptyHint")} />
        ) : (
          <>
            {standing ? (
              <StandingStrip
                rank={standing.rank}
                total={standing.total}
                belowPage={standing.belowPage}
                delta={rankDelta}
              />
            ) : null}
            <div className="grid grid-cols-[2rem_1fr_3.5rem] gap-2 px-3 pb-1 label text-ink-3">
              <span>{t("board.rank")}</span>
              <span>{t("board.player")}</span>
              <span className="text-end">{t("board.points")}</span>
            </div>
            <ul className="space-y-1.5">
              {rows.map((row, index) => (
                <BoardRow
                  key={row.username ?? row.display_name}
                  index={index}
                  rank={row.rank}
                  name={row.display_name}
                  total={row.total}
                  highlight={row.is_you}
                  youLabel={t("board.you")}
                  delta={row.is_you ? rankDelta : null}
                />
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}

/**
 * The viewer's own line, promoted to the top of the board. A list of strangers
 * is honest but inert; leading with "you are #12 on 87" is the fact this screen
 * exists to deliver. Uses the same volt/gold grammar as the highlighted row.
 */
function StandingStrip({
  rank,
  total,
  belowPage,
  delta,
}: {
  rank: number;
  total: number;
  belowPage: boolean;
  /** Session rank movement: positive = climbed, null = no honest comparison. */
  delta?: number | null;
}) {
  const { t } = useI18n();
  return (
    <div className="mb-3 flex items-center justify-between gap-3 rounded-card border border-volt bg-elevated p-3">
      <div className="min-w-0">
        <p className="label text-ink-3">{t("board.yourStanding")}</p>
        <p className="truncate text-sm font-bold text-ink">{t("board.you")}</p>
        {belowPage ? <p className="text-[11px] text-ink-3">{t("board.belowPage")}</p> : null}
      </div>
      <div className="flex flex-none items-center gap-4 text-end">
        <div>
          <p className="label text-ink-3">{t("board.rankLabel")}</p>
          {/* Keyed on rank: a movement between focus refetches remounts the
              number, so marker-pop replays instead of the digits just swapping. */}
          <Num key={rank} className="marker-pop inline-block text-lg font-black text-volt">
            #{rank}
          </Num>
          <RankDelta delta={delta} />
        </div>
        <div>
          <p className="label text-ink-3">{t("board.points")}</p>
          <CountUp value={total} className="text-lg font-black text-gold" />
        </div>
      </div>
    </div>
  );
}

/**
 * ▲/▼ movement since this viewer last saw this board — purely session-scoped,
 * so it only ever claims what the client actually observed. The chip mounts
 * (and so pops via marker-pop) only when a delta exists; leaving the board and
 * coming back re-observes and starts fresh.
 */
function RankDelta({ delta }: { delta?: number | null }) {
  const { t } = useI18n();
  if (!delta) return null;
  const up = delta > 0;
  return (
    <Chip tone={up ? "pitch" : "muted"} className="marker-pop ms-1.5">
      <ChevronDownIcon aria-hidden="true" className={cx("h-3 w-3", up && "rotate-180")} />
      <span className="sr-only">{t(up ? "board.rankUp" : "board.rankDown", { n: Math.abs(delta) })}</span>
      <span aria-hidden="true">
        <Num>{Math.abs(delta)}</Num>
      </span>
    </Chip>
  );
}

function BoardRow({
  index,
  rank,
  name,
  total,
  highlight,
  youLabel,
  delta,
}: {
  index: number;
  rank: number;
  name: string;
  total: number;
  highlight: boolean;
  youLabel?: string;
  /** Session rank movement for this row; only the viewer's row carries one. */
  delta?: number | null;
}) {
  return (
    <li
      className={cx(
        "list-in grid grid-cols-[2rem_1fr_3.5rem] items-center gap-2 rounded-card border p-2.5",
        highlight ? "border-volt bg-elevated" : "border-line bg-surface",
      )}
      style={{ "--stagger": `${Math.min(index, 8) * 40}ms` } as CSSProperties}
    >
      <Num
        // Keyed on rank: a movement between focus refetches remounts the
        // number so marker-pop replays for the viewer's own line.
        key={highlight ? rank : "static"}
        className={cx(
          "text-sm font-bold",
          highlight && "marker-pop",
          rank === 1 ? "text-gold" : rank <= 3 ? "text-ink" : "text-ink-3",
        )}
      >
        {rank}
      </Num>
      <span className="flex min-w-0 items-center gap-2">
        <Avatar name={name} size="sm" />
        {/* dir=auto: display names are user data. Forcing LTR mis-orders
            Persian names and any trailing punctuation; auto picks the
            direction from the name's own first strong character. */}
        <span
          className={cx("min-w-0 flex-1 truncate text-sm font-bold", highlight ? "text-volt" : "text-ink")}
          dir="auto"
        >
          {name}
        </span>
        {youLabel ? <Chip tone="volt">{youLabel}</Chip> : null}
        <RankDelta delta={delta} />
      </span>
      <CountUp value={total} className="text-end text-base text-gold" />
    </li>
  );
}

/* ------------------------------------------------------------ league picker */

function LeaguePicker({ value, onChange }: { value: string; onChange: (slug: string) => void }) {
  const tabs = useLeagueTabs();
  // Board state is a slug end-to-end; tab values are big-five aliases, so
  // aliases translate back through SLUG_BY_LEAGUE and extras pass through.
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={tabs.map((tab) => ({
        value: slugForLeague(tab.value),
        label: tab.label,
      }))}
    />
  );
}
