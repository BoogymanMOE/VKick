import { useState } from "react";
import { Link } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { RowSkeleton } from "../components/Skeletons";
import { EmptyState, ErrorState } from "../components/ui";
import { Chip, Num, SectionHeading, Segmented, TeamBadge, cx } from "../components/ui";
import { StarFilledIcon } from "../components/icons";
import { LEAGUE_TABS, SLUG_BY_LEAGUE, useStandings, type StandingRow } from "../hooks/useApi";

type TableView = "actual" | "expected";
import { useFavorites } from "../hooks/useFavorites";
import { useI18n } from "../i18n/I18nProvider";
import type { LeagueId } from "../types";

/**
 * League tables for the synced domestic leagues — straight from the standings.
 * Your clubs are highlighted in every table, and the summary strip jumps to the
 * league each of them plays in.
 */
export default function Table() {
  const { t, localize } = useI18n();
  const { teams: clubs, isFavorite } = useFavorites();
  const [league, setLeague] = useState<LeagueId | null>(null);
  const [view, setView] = useState<TableView>("actual");

  // Default to the league one of your clubs plays in, else the Premier League.
  const active = league ?? clubs[0]?.league ?? "PL";
  const slug = SLUG_BY_LEAGUE[active];
  const standingsQuery = useStandings(slug);
  const rows = standingsQuery.data ?? [];

  // Expected points ride along on the standings payload (one left join
  // server-side, no extra request), and only the clubs Understat covers have
  // them — so "no data" is a normal state here, never an error.
  const hasExpected = rows.some((row) => row.xpts != null);
  // Ranked by xPts, with the uncovered clubs parked below in table order
  // (Array#sort is stable) rather than dropped or given a fake rank.
  const expectedRows = [...rows].sort((a, b) => (b.xpts ?? -1) - (a.xpts ?? -1));

  return (
    <>
      <TopBar title={t("table.title")} subtitle={t("table.subtitle")} />

      <div className="mt-3">
        <Segmented
          value={active}
          onChange={setLeague}
          options={LEAGUE_TABS.map((id) => ({ value: id, label: t(`league.${id}`) }))}
        />
      </div>

      {/* Your clubs across all five leagues, with the position each sits in. */}
      <section className="mt-4">
        <SectionHeading
          title={t("table.myClubs")}
          action={
            clubs.length > 0 ? (
              <Chip tone="volt">
                <Num>{clubs.length}</Num>
              </Chip>
            ) : null
          }
        />
        {clubs.length > 0 ? (
          <ul className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
            {clubs.map((club) => (
              <li key={club.id} className="flex-none">
                <button
                  type="button"
                  onClick={() => setLeague(club.league)}
                  className={cx(
                    "flex w-[76px] flex-col items-center gap-1 rounded-card border p-2.5 text-center transition-colors duration-[var(--t-fast)]",
                    club.league === active
                      ? "border-volt bg-elevated"
                      : "border-line bg-surface hover:bg-elevated",
                  )}
                >
                  <TeamBadge team={club} size="sm" />
                  <span className="w-full truncate text-[11px] font-bold text-ink">
                    {localize(club.shortName)}
                  </span>
                  <span className="text-[10px] text-ink-3">{t(`league.${club.league}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Link
            to="/my-teams"
            className="block rounded-card border border-dashed border-line px-3 py-4 text-center text-xs text-ink-3 transition-colors duration-[var(--t-fast)] hover:bg-elevated"
          >
            {t("table.noClubs")}
          </Link>
        )}
      </section>

      <section className="mt-4">
        <SectionHeading
          title={t(`league.${active}`)}
          action={
            standingsQuery.data?.length ? (
              <span className="text-[11px] text-ink-3">{standingsQuery.data[0]?.played ?? 0} GW</span>
            ) : null
          }
        />
        {standingsQuery.isLoading ? (
          <RowSkeleton rows={8} />
        ) : standingsQuery.isError ? (
          <ErrorState onRetry={() => standingsQuery.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t("table.emptyTitle")}
            hint={t("table.emptyHint")}
            action={
              <Link
                to="/my-teams"
                className="min-h-11 rounded-full border border-volt px-5 text-xs font-bold leading-[2.75rem] text-volt transition-colors duration-[var(--t-fast)] hover:bg-elevated"
              >
                {t("table.emptyAction")}
              </Link>
            }
          />
        ) : (
          <>
            <Segmented
              value={view}
              onChange={setView}
              className="mb-2"
              options={[
                { value: "actual", label: t("table.viewActual") },
                { value: "expected", label: t("table.viewExpected") },
              ]}
            />

            {view === "expected" ? (
              hasExpected ? (
                <>
                  {/* Same shell as the real table so switching views doesn't
                      move the page: header grid + hairline dividers. */}
                  <div className="overflow-hidden rounded-card border border-line bg-surface">
                    <div
                      aria-hidden="true"
                      className="grid grid-cols-[1.5rem_1fr_1.75rem_2.25rem_2.25rem_2.25rem] gap-1.5 border-b border-line bg-elevated px-3 py-2 label text-ink-3"
                    >
                      <span>{t("table.rank")}</span>
                      <span>{t("table.team")}</span>
                      <span className="text-end">{t("table.played")}</span>
                      <span className="text-end">{t("table.xpts")}</span>
                      <span className="text-end">{t("table.pts")}</span>
                      <span className="text-end">{t("table.diff")}</span>
                    </div>
                    <ul className="divide-y divide-line">
                      {expectedRows.map((row, index) => (
                        <ExpectedItem
                          key={row.team.id}
                          row={row}
                          rank={row.xpts == null ? null : index + 1}
                          mine={isFavorite(row.team.id)}
                        />
                      ))}
                    </ul>
                  </div>
                  <p className="mt-2 text-[11px] text-ink-3">{t("table.expectedHint")}</p>
                </>
              ) : (
                <EmptyState title={t("table.expectedEmpty")} hint={t("table.expectedEmptyHint")} />
              )
            ) : null}

            {view === "actual" ? (
              /* One bordered table, not a stack of bordered cards: the header
                 shares the rows' grid so every column lines up, and hairline
                 dividers carry the rhythm instead of 20 separate borders. */
              <div className="overflow-hidden rounded-card border border-line bg-surface">
                <div
                  aria-hidden="true"
                  className="grid grid-cols-[1.75rem_1fr_2rem_2.5rem_2.5rem] gap-2 border-b border-line bg-elevated px-3 py-2 label text-ink-3"
                >
                  <span>{t("table.rank")}</span>
                  <span>{t("table.team")}</span>
                  <span className="text-end">{t("table.played")}</span>
                  <span className="text-end">{t("table.gd")}</span>
                  <span className="text-end">{t("table.pts")}</span>
                </div>
                <ul className="divide-y divide-line">
                  {rows.map((row, index) => (
                    <StandingItem key={row.team.id} row={row} index={index} mine={isFavorite(row.team.id)} />
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </section>
    </>
  );
}

function StandingItem({ row, index, mine }: { row: StandingRow; index: number; mine: boolean }) {
  const { t, localize } = useI18n();
  const gd = (row.goalsFor ?? 0) - (row.goalsAgainst ?? 0);
  return (
    <li
      className={cx(
        "relative grid grid-cols-[1.75rem_1fr_2rem_2.5rem_2.5rem] items-center gap-2 px-3 py-2 transition-colors duration-[var(--t-fast)]",
        mine ? "bg-elevated" : "hover:bg-elevated/60",
      )}
    >
      <Num className={cx("text-sm", mine ? "text-volt" : index < 3 ? "text-gold" : "text-ink-3")}>
        {row.rank ?? index + 1}
      </Num>
      {/* Stretched link: the <a> sits in the team column (so the grid stays one
          row), and its ::after covers the whole row — every tap, rank to
          points, opens the club page, so the row is one 44px+ touch target. */}
      <Link
        to={`/team/${row.team.id}`}
        className="flex min-h-11 min-w-0 items-center gap-2 after:absolute after:inset-0"
      >
        <TeamBadge team={row.team} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
          {localize(row.team.shortName)}
        </span>
        {row.form ? <FormStrip form={row.form} /> : null}
        {mine ? <StarFilledIcon className="h-3 w-3 flex-none text-volt" /> : null}
      </Link>
      <Num className="text-end text-xs text-ink-3">{row.played ?? "–"}</Num>
      <Num className={cx("text-end text-xs", gd >= 0 ? "text-ink-2" : "text-ink-3")}>
        {gd > 0 ? `+${gd}` : gd}
      </Num>
      <Num className="text-end text-sm text-ink">{row.points ?? "–"}</Num>
      <span className="sr-only">{t("table.pts")}</span>
    </li>
  );
}

/**
 * The last five results, oldest first. Letters rather than dots: at this size a
 * 6px dot is a smudge, and "WWDLW" still fits beside a truncated club name on
 * the narrowest phone. One image for screen readers, so the label reads as a
 * sentence instead of five stray letters; `dir="ltr"` keeps the newest result
 * on the right in Farsi too, where a Latin run would otherwise be reordered.
 */
function FormStrip({ form }: { form: string }) {
  const { t } = useI18n();
  const results = [...form];
  const label = results
    .map((r) => (r === "W" ? t("table.formW") : r === "L" ? t("table.formL") : t("table.formD")))
    .join(", ");
  return (
    <span
      role="img"
      aria-label={`${t("table.form")}: ${label}`}
      dir="ltr"
      className="flex flex-none gap-px text-[9px] font-black leading-none"
    >
      {results.map((result, index) => (
        <span
          key={index}
          className={cx(result === "W" ? "text-pitch" : result === "L" ? "text-danger" : "text-ink-3")}
        >
          {result}
        </span>
      ))}
    </span>
  );
}

/**
 * One row of the expected table: what a club's chances were worth set against
 * what it actually banked. `rank` is null for a club Understat doesn't cover —
 * it is still listed, unranked and dimmed, because dropping it would quietly
 * make this look like a different league.
 */
function ExpectedItem({ row, rank, mine }: { row: StandingRow; rank: number | null; mine: boolean }) {
  const { t, localize } = useI18n();
  const expected = row.xpts;
  const actual = row.points;
  const delta = expected != null && actual != null ? actual - expected : null;
  return (
    <li
      className={cx(
        "relative grid grid-cols-[1.5rem_1fr_1.75rem_2.25rem_2.25rem_2.25rem] items-center gap-1.5 px-3 py-2 transition-colors duration-[var(--t-fast)]",
        mine ? "bg-elevated" : "hover:bg-elevated/60",
        expected == null && "opacity-55",
      )}
    >
      <Num className="text-xs text-ink-3">{rank ?? "–"}</Num>
      <Link
        to={`/team/${row.team.id}`}
        className="flex min-h-11 min-w-0 items-center gap-2 after:absolute after:inset-0"
      >
        <TeamBadge team={row.team} size="sm" />
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
          {localize(row.team.shortName)}
        </span>
        {mine ? <StarFilledIcon className="h-3 w-3 flex-none text-volt" /> : null}
      </Link>
      <Num className="text-end text-xs text-ink-3">{row.played ?? "–"}</Num>
      {/* The header grid is decorative (aria-hidden, as in the real table), so
          every figure names itself; the wrappers keep the cell count even. */}
      <span className="text-end">
        <Num className="text-xs font-bold text-gold">{expected != null ? expected.toFixed(1) : "–"}</Num>
        <span className="sr-only"> {t("table.xpts")}</span>
      </span>
      <span className="text-end">
        <Num className="text-xs text-ink">{actual ?? "–"}</Num>
        <span className="sr-only"> {t("table.pts")}</span>
      </span>
      <span className="text-end">
        <Num
          className={cx(
            "text-xs font-bold",
            delta == null ? "text-ink-3" : delta >= 0 ? "text-volt" : "text-danger",
          )}
        >
          {delta == null ? "–" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}`}
        </Num>
        <span className="sr-only"> {t("xg.expected")}</span>
      </span>
    </li>
  );
}
