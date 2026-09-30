import { useState } from "react";
import { TopBar } from "../components/TopBar";
import { Avatar, Chip, EmptyState, ErrorState, Num, SectionHeading, Segmented, cx } from "../components/ui";
import { LEAGUE_TABS, SLUG_BY_LEAGUE, useLeaderboard, type LeaderboardScope } from "../hooks/useApi";
import { useFavorites } from "../hooks/useFavorites";
import { useI18n } from "../i18n/I18nProvider";

type BoardTab = "global" | "league" | "club";

/**
 * The stakes layer, made visible: season prediction points across the three
 * boards from the concept — global, per-league, per-club. Public by design;
 * ties resolved by first-to-reach (the server ranks, we render).
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

  // The signed-in user's display name comes from the board row; there is no
  // separate identity chip, so we just render rows.
  const rows = board.data ?? [];

  return (
    <>
      <TopBar title={t("board.title")} subtitle={t("board.subtitle")} />

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
            <div className="grid grid-cols-[2rem_1fr_3.5rem] gap-2 px-3 pb-1 label text-ink-3">
              <span>{t("board.rank")}</span>
              <span>{t("board.player")}</span>
              <span className="text-end">{t("board.points")}</span>
            </div>
            <ul className="space-y-1.5">
              {rows.map((row) => (
                <li
                  key={row.username ?? row.display_name}
                  className={cx(
                    "grid grid-cols-[2rem_1fr_3.5rem] items-center gap-2 rounded-card border p-2.5",
                    row.is_you ? "border-volt bg-elevated" : "border-line bg-surface",
                  )}
                >
                  <Num
                    className={cx(
                      "text-sm font-bold",
                      row.rank === 1 ? "text-gold" : row.rank <= 3 ? "text-ink" : "text-ink-3",
                    )}
                  >
                    {row.rank}
                  </Num>
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar name={row.display_name} size="sm" />
                    <span
                      className={cx(
                        "min-w-0 flex-1 truncate text-sm font-bold",
                        row.is_you ? "text-volt" : "text-ink",
                      )}
                      dir="ltr"
                    >
                      {row.display_name}
                    </span>
                    {row.is_you ? <Chip tone="volt">{t("board.you")}</Chip> : null}
                  </span>
                  <Num className="text-end text-base text-gold">{row.total}</Num>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}

/* ------------------------------------------------------------ league picker */

function LeaguePicker({ value, onChange }: { value: string; onChange: (slug: string) => void }) {
  const { t } = useI18n();
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={LEAGUE_TABS.map((id) => ({ value: SLUG_BY_LEAGUE[id], label: t(`league.${id}`) }))}
    />
  );
}
