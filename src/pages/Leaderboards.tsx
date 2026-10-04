import { useState } from "react";
import { Link } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { RulesButton } from "../components/RulesSheet";
import { ChartIcon } from "../components/icons";
import { Avatar, Chip, EmptyState, ErrorState, Num, SectionHeading, Segmented, cx } from "../components/ui";
import { slugForLeague, useLeaderboard, useLeagueTabs, type LeaderboardScope } from "../hooks/useApi";
import { useFavorites } from "../hooks/useFavorites";
import { useI18n } from "../i18n/I18nProvider";
import { viewerStanding } from "../lib/leaderboard";

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
                      "flex w-[76px] flex-col items-center gap-1 rounded-card border p-2.5 text-center transition-colors duration-[var(--t-fast)]",
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
              />
            ) : null}
            <div className="grid grid-cols-[2rem_1fr_3.5rem] gap-2 px-3 pb-1 label text-ink-3">
              <span>{t("board.rank")}</span>
              <span>{t("board.player")}</span>
              <span className="text-end">{t("board.points")}</span>
            </div>
            <ul className="space-y-1.5">
              {rows.map((row) => (
                <BoardRow
                  key={row.username ?? row.display_name}
                  rank={row.rank}
                  name={row.display_name}
                  total={row.total}
                  highlight={row.is_you}
                  youLabel={t("board.you")}
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
}: {
  rank: number;
  total: number;
  belowPage: boolean;
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
          <Num className="text-lg font-black text-volt">
            #{rank}
          </Num>
        </div>
        <div>
          <p className="label text-ink-3">{t("board.points")}</p>
          <Num className="text-lg font-black text-gold">{total}</Num>
        </div>
      </div>
    </div>
  );
}

function BoardRow({
  rank,
  name,
  total,
  highlight,
  youLabel,
}: {
  rank: number;
  name: string;
  total: number;
  highlight: boolean;
  youLabel?: string;
}) {
  return (
    <li
      className={cx(
        "grid grid-cols-[2rem_1fr_3.5rem] items-center gap-2 rounded-card border p-2.5",
        highlight ? "border-volt bg-elevated" : "border-line bg-surface",
      )}
    >
      <Num
        className={cx("text-sm font-bold", rank === 1 ? "text-gold" : rank <= 3 ? "text-ink" : "text-ink-3")}
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
      </span>
      <Num className="text-end text-base text-gold">{total}</Num>
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
