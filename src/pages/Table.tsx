import { useState, useMemo, type CSSProperties } from "react";
import { Link, useNavigate } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { RowSkeleton, CompRowSkeleton } from "../components/Skeletons";
import { EmptyState, ErrorState, Chip, SectionHeading, TeamBadge, LiveDot, Num, CountUp, Segmented } from "../components/ui";
import { cx } from "../lib/cx";

import { ChevronRightIcon, StarFilledIcon } from "../components/icons";
import { slugForLeague, useLeagueTabs, useStandings, useMatches, useCompetitions, type StandingRow } from "../hooks/useApi";
import { isCup } from "../lib/leagues";
import { useFavorites } from "../hooks/useFavorites";
import { useI18n } from "../i18n/context";
import { haptic } from "../lib/telegram";
import type { Match } from "../types";

type TableView = "actual" | "expected";
type BrowseView = "tables" | "browse";

/**
 * League tables for the synced domestic leagues — straight from the standings.
 * Your clubs are highlighted in every table, and the summary strip jumps to the
 * league each of them plays in.
 */
export default function Table() {
  const { t, localize } = useI18n();
  const { teams: clubs, isFavorite } = useFavorites();
  const tabs = useLeagueTabs();
  const [league, setLeague] = useState<string | null>(null);
  const [view, setView] = useState<TableView>("actual");
  const [browseView, setBrowseView] = useState<BrowseView>("tables");

  // Default to the league one of your clubs plays in, else the Premier League.
  // `clubs[].league` is a big-five alias (teamFromApi parks every other side
  // in "PL"), so the default always lands on a tab that exists.
  const active = league ?? clubs[0]?.league ?? "PL";
  const slug = slugForLeague(active);
  // Tab labels carry the translation: aliases come pre-translated, followed
  // extras read their catalog name — `league.<slug>` i18n keys don't exist.
  const tabLabel = (value: string) => tabs.find((tab) => tab.value === value)?.label ?? value;
  const standingsQuery = useStandings(slug);
  const rows = standingsQuery.data ?? [];

  // Expected points ride along on the standings payload (one left join
  // server-side, no extra request), and only the clubs Understat covers have
  // them — so "no data" is a normal state here, never an error. Understat only
  // scrapes the big five, so for any other league the Expected tab would open
  // onto an empty board; in that case the tab is hidden rather than shown
  // disabled, because a control that can never do anything is worse than an
  // absent one.
  const hasExpected = rows.some((row) => row.xpts != null);
  // Guard the view itself too: if it somehow renders without data (a league
  // that gains coverage mid-session), fall back to the real table instead of
  // a grid of dashes.
  const showExpected = view === "expected" && hasExpected;
  // Ranked by xPts, with the uncovered clubs parked below in table order
  // (Array#sort is stable) rather than dropped or given a fake rank.
  const expectedRows = [...rows].sort((a, b) => (b.xpts ?? -1) - (a.xpts ?? -1));

  return (
    <>
      <TopBar title={t("table.title")} subtitle={t("table.subtitle")} />

      {/* Tables / Browse is the FIRST control on the page, and the league chips
          live only inside the Tables view — otherwise the chips sit above a
          Browse list and look like they should filter it, but cannot. */}
      <div className="mt-3">
        <Segmented
          value={browseView}
          onChange={setBrowseView}
          options={[
            { value: "tables", label: t("table.view.tables") },
            { value: "browse", label: t("table.view.browse") },
          ]}
        />
      </div>

      {browseView === "tables" && (
        <div className="mt-3">
          <Segmented
            value={active}
            onChange={setLeague}
            options={tabs.map((tab) => ({ value: tab.value, label: tab.label }))}
          />
        </div>
      )}

      {/* Tables view: standings + your clubs */}
      {browseView === "tables" && (
        <>
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
                    "flex w-[76px] flex-col items-center gap-1 rounded-card border p-2.5 text-center transition-[background-color,transform] duration-[var(--t-fast)] active:scale-[0.97]",
                    club.league === active
                      ? "border-volt bg-elevated"
                      : "border-line bg-surface hover:bg-elevated",
                  )}
                >
                  <TeamBadge team={club} size="sm" />
                  <span className="w-full truncate text-xs font-bold text-ink">
                    {localize(club.shortName)}
                  </span>
                  <span className="text-xs text-ink-3">{t(`league.${club.league}`)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Link
            to="/onboarding"
            className="block rounded-card border border-dashed border-line px-3 py-4 text-center text-xs text-ink-3 transition-colors duration-[var(--t-fast)] hover:bg-elevated"
          >
            {t("table.noClubs")}
          </Link>
        )}
      </section>

          <section className="mt-4">
        {isCup(slug) ? (
          <CupView slug={slug} rows={rows} />
        ) : (
          <>
            <SectionHeading
              title={tabLabel(active)}
              action={
                standingsQuery.data?.length ? (
                  <span className="text-xs text-ink-3">
                    {t("table.gw", { gw: standingsQuery.data[0]?.played ?? 0 })}
                  </span>
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
                    to="/onboarding"
                    className="min-h-11 rounded-lg border border-volt px-5 text-xs font-bold leading-[2.75rem] text-volt transition-colors duration-[var(--t-fast)] hover:bg-elevated"
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
                  options={
                    hasExpected
                      ? [
                          { value: "actual", label: t("table.viewActual") },
                          { value: "expected", label: t("table.viewExpected") },
                        ]
                      : [{ value: "actual", label: t("table.viewActual") }]
                  }
                />

                {showExpected ? (
                  hasExpected ? (
                    <>
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
                              index={index}
                              rank={row.xpts == null ? null : index + 1}
                              mine={isFavorite(row.team.id)}
                            />
                          ))}
                        </ul>
                      </div>
                      <p className="mt-2 text-xs text-ink-3">{t("table.expectedHint")}</p>
                    </>
                  ) : (
                    <EmptyState title={t("table.expectedEmpty")} hint={t("table.expectedEmptyHint")} />
                  )
                ) : null}

                {view === "actual" ? (
                  <div className="overflow-hidden rounded-card border border-line bg-surface">
                    <StandingsHeader />
                    <ul className="divide-y divide-line">
                      {rows.map((row, index) => (
                        <StandingItem
                          key={row.team.id}
                          row={row}
                          index={index}
                          mine={isFavorite(row.team.id)}
                        />
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </>
        )}
        </section>
        </>
      )}

      {/* Browse view: league browser */}
      {browseView === "browse" && <BrowseContent />}
    </>
  );
}

/**
 * Browse view: league/cup/tournament browser, merged from the old Browse page.
 */
function BrowseContent() {
  const { t, localize } = useI18n();
  const navigate = useNavigate();
  const query = useCompetitions();
  const [filter, setFilter] = useState<"all" | "league" | "cup">("all");
  const groups = useMemo(() => {
    const comps = query.data?.competitions ?? [];
    const visible = comps.filter((c) => (filter === "all" ? true : c.kind === filter));
    return {
      leagues: visible.filter((c) => c.kind === "league"),
      cups: visible.filter((c) => c.kind === "cup"),
      tournaments: visible.filter((c) => c.kind === "tournament"),
    };
  }, [query.data, filter]);

  const sections = useMemo(() => [
    { title: t("browse.leagues"), rows: groups.leagues },
    { title: t("browse.cups"), rows: groups.cups },
    ...(groups.tournaments.length > 0 ? [{ title: t("browse.tournaments"), rows: groups.tournaments }] : []),
  ], [groups]);

  const open = (slug: string, comingSoon: boolean | undefined, kind: string) => {
    if (comingSoon) return;
    haptic("light");
    if (kind === "league") navigate(`/matches?league=${encodeURIComponent(slug)}`);
    else navigate(`/cups?cup=${encodeURIComponent(slug)}`);
  };

  return (
    <>
      <div
        className="mt-3 grid grid-cols-3 gap-1 rounded-lg border border-line bg-surface p-1"
        role="group"
        aria-label={t("browse.filterLabel")}
      >
        {(
          [
            ["all", "browse.all"],
            ["league", "browse.leagues"],
            ["cup", "browse.cups"],
          ] as const
        ).map(([value, key]) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => {
              haptic("light");
              setFilter(value);
            }}
            className={cx(
              "min-h-11 rounded-lg text-xs font-bold transition-[color,background-color,transform] duration-[var(--t-fast)] active:scale-[0.97]",
              filter === value ? "bg-elevated text-volt" : "text-ink-2 hover:text-ink",
            )}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="mt-4">
          <CompRowSkeleton rows={6} />
        </div>
      ) : groups.leagues.length + groups.cups.length + groups.tournaments.length === 0 ? (
        // The filter user picked (or the catalog) has nothing to list — say so
        // instead of fading out into a silent blank panel.
        <div className="mt-4 fade-swap">
          <EmptyState icon="📈" title={t("browse.empty")} hint={t("browse.emptyHint")} />
        </div>
      ) : (
        sections.map(
          ({ title, rows }) =>
            rows.length > 0 && (
              <section key={title} className="mt-5 fade-swap">
                <SectionHeading
                  title={title}
                  action={
                    <Chip tone="muted">
                      <Num>{rows.length}</Num>
                    </Chip>
                  }
                />
                <ul className="space-y-2">
                  {rows.map((comp) => {
                    const soon = Boolean(comp.comingSoon);
                    const Wrapper = soon ? "div" : "button";
                    return (
                      <li key={comp.slug}>
                        <Wrapper
                          {...(soon
                            ? {}
                            : {
                                type: "button" as const,
                                onClick: () => open(comp.slug, comp.comingSoon, comp.kind),
                              })}
                          className={cx(
                            "flex w-full items-center gap-3 rounded-card border p-3 text-start transition-colors duration-[var(--t-fast)]",
                            soon
                              ? "border-dashed border-line bg-transparent opacity-70"
                              : "border-line bg-surface hover:bg-elevated",
                          )}
                        >
                          {/* No monogram tile: a single letter beside the full
                              name reads as doubled text ("PPremier League") —
                              the same call the onboarding league list made. */}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold text-ink">
                              {localize(comp.name)}
                            </span>
                            <span className="block truncate text-xs text-ink-3">
                              {soon ? t("browse.comingSoon") : t("browse.liveScores")}
                            </span>
                          </span>
                          {soon ? (
                            <Chip tone="muted">{t("browse.soon")}</Chip>
                          ) : (
                            <ChevronRightIcon className="text-ink-3" />
                          )}
                        </Wrapper>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ),
        )
      )}
    </>
  );
}

/**
 * Six columns — Rank, Team, P, GD, Pts, Form — across a 390px phone. The old
 * eleven-column grid carried W/D/L and GF/GA too, needed `min-w-[640px]` and
 * pushed Pts and Form off-screen behind a sideways scroll; those extra figures
 * live on the club page's Stats tab. The width string must stay ONE complete
 * literal so Tailwind can see it: 1.5rem rank, flexible team, then 1.75/2/2.25/3rem.
 */
const COLS = "grid-cols-[1.5rem_minmax(0,1fr)_1.75rem_2rem_2.25rem_3rem]";

function StandingsHeader() {
  const { t } = useI18n();
  return (
    <div
      aria-hidden="true"
      className={cx(
        "grid",
        COLS,
        "gap-2 border-b border-line bg-elevated px-3 py-2 text-xs font-bold text-ink-3",
      )}
    >
      <span>{t("table.rank")}</span>
      <span>{t("table.team")}</span>
      <span className="text-end">{t("table.played")}</span>
      <span className="text-end">{t("table.gd")}</span>
      <span className="text-end">{t("table.pts")}</span>
      <span className="text-end">{t("table.form")}</span>
    </div>
  );
}

function StandingItem({ row, index, mine }: { row: StandingRow; index: number; mine: boolean }) {
  const { localize } = useI18n();
  const gd = (row.goalsFor ?? 0) - (row.goalsAgainst ?? 0);
  return (
    <li
      className={cx(
        "list-in relative grid",
        COLS,
        "items-center gap-2 px-3 py-2 transition-[background-color,transform] duration-[var(--t-fast)] active:scale-[0.99]",
        mine ? "bg-elevated" : "hover:bg-elevated/60",
      )}
      style={{ "--stagger": `${Math.min(index, 8) * 40}ms` } as CSSProperties}
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
        {mine ? <StarFilledIcon className="h-3 w-3 flex-none text-volt" /> : null}
      </Link>
      <Num className="text-end text-xs text-ink-3">{row.played ?? "–"}</Num>
      <Num className={cx("text-end text-xs", gd >= 0 ? "text-ink-2" : "text-ink-3")}>
        {gd > 0 ? `+${gd}` : gd}
      </Num>
      {row.points != null ? (
        <CountUp value={row.points} className="text-end text-sm text-ink" />
      ) : (
        <Num className="text-end text-sm text-ink">–</Num>
      )}
      {row.form ? <FormStrip form={row.form} /> : <span className="text-end text-xs text-ink-3">–</span>}
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
      className="flex flex-none gap-0.5 text-xs font-black leading-none"
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
function ExpectedItem({
  row,
  index,
  rank,
  mine,
}: {
  row: StandingRow;
  index: number;
  rank: number | null;
  mine: boolean;
}) {
  const { t, localize } = useI18n();
  const expected = row.xpts;
  const actual = row.points;
  const delta = expected != null && actual != null ? actual - expected : null;
  return (
    <li
      className={cx(
        "list-in relative grid grid-cols-[1.5rem_1fr_1.75rem_2.25rem_2.25rem_2.25rem] items-center gap-1.5 px-3 py-2 transition-[background-color,transform] duration-[var(--t-fast)] active:scale-[0.99]",
        mine ? "bg-elevated" : "hover:bg-elevated/60",
        // Uncovered clubs read as incomplete WITHOUT dimming the text: the row
        // darkens toward --bg-base instead, so the ink-3 numerals keep their
        // AA-passing contrast (opacity-55 on the whole row measured ≈2.4:1).
        expected == null && !mine && "bg-base/50",
      )}
      style={{ "--stagger": `${Math.min(index, 8) * 40}ms` } as CSSProperties}
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
        {expected != null ? (
          <CountUp value={expected} decimals={1} className="text-xs font-bold text-gold" />
        ) : (
          <Num className="text-xs font-bold text-gold">–</Num>
        )}
        <span className="sr-only"> {t("table.xpts")}</span>
      </span>
      <span className="text-end">
        {actual != null ? (
          <CountUp value={actual} className="text-xs text-ink" />
        ) : (
          <Num className="text-xs text-ink">–</Num>
        )}
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

function CupView({ slug, rows }: { slug: string; rows: StandingRow[] }) {
  const { localize } = useI18n();
  const { isFavorite } = useFavorites();

  if (rows.length > 0) {
    const groups = new Map<string, StandingRow[]>();
    for (const row of rows) {
      const key = row.groupName ?? "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
    return (
      <div className="space-y-4">
        {Array.from(groups.entries()).map(([groupName, groupRows]) => (
          <section key={groupName}>
            <SectionHeading title={localize(groupName)} />
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              <StandingsHeader />
              <ul className="divide-y divide-line">
                {groupRows.map((row, index) => (
                  <StandingItem key={row.team.id} row={row} index={index} mine={isFavorite(row.team.id)} />
                ))}
              </ul>
            </div>
          </section>
        ))}
      </div>
    );
  }

  return <KnockoutView slug={slug} />;
}

function KnockoutView({ slug }: { slug: string }) {
  const { t, localize } = useI18n();
  const matchesQuery = useMatches({ league: slug });
  const matches = matchesQuery.data ?? [];
  const cupMatches = matches.filter((m) => m.round != null);

  if (matchesQuery.isLoading) {
    return <RowSkeleton rows={8} />;
  }
  if (matchesQuery.isError) {
    return <ErrorState onRetry={() => matchesQuery.refetch()} />;
  }
  if (cupMatches.length === 0) {
    return <EmptyState icon="📈" title={t("table.emptyTitle")} hint={t("table.emptyHint")} />;
  }

  const rounds = new Map<string, Match[]>();
  for (const match of cupMatches) {
    const key = match.round!;
    if (!rounds.has(key)) rounds.set(key, []);
    rounds.get(key)!.push(match);
  }

  return (
    <div className="space-y-4">
      {Array.from(rounds.entries()).map(([round, roundMatches]) => (
        <section key={round}>
          <SectionHeading title={localize(round)} />
          <ul className="space-y-2">
            {roundMatches.map((match) => (
              <li key={match.id}>
                <Link
                  to={`/match/${match.id}`}
                  className="flex items-center gap-3 rounded-card border border-line bg-surface px-3 py-2.5 transition-colors duration-[var(--t-fast)] hover:bg-elevated"
                >
                  <div className="flex flex-1 items-center justify-end gap-2">
                    <TeamBadge team={match.home} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-right text-sm font-bold text-ink">
                      {localize(match.home.shortName)}
                    </span>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    {match.status === "scheduled" ? (
                      <span className="text-xs text-ink-3">vs</span>
                    ) : (
                      <Num className="text-sm font-bold text-ink">
                        {match.homeScore ?? 0} - {match.awayScore ?? 0}
                      </Num>
                    )}
                    {match.status === "live" || match.status === "halftime" ? <LiveDot /> : null}
                  </div>
                  <div className="flex flex-1 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                      {localize(match.away.shortName)}
                    </span>
                    <TeamBadge team={match.away} size="sm" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
