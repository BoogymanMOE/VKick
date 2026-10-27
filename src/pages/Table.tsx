import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { RowSkeleton } from "../components/Skeletons";
import {
  EmptyState,
  ErrorState,
  LiveDot,
  Num,
  SectionHeading,
  Segmented,
  TeamBadge,
  CountUp,
} from "../components/ui";
import { cx } from "../lib/cx";

import { StarFilledIcon } from "../components/icons";
import { slugForLeague, useLeagueTabs, useStandings, useMatches, type StandingRow } from "../hooks/useApi";
import { isCup } from "../lib/leagues";
import { useFavorites } from "../hooks/useFavorites";
import { useI18n } from "../i18n/context";
import { haptic } from "../lib/telegram";
import type { Match } from "../types";

/**
 * League tables for the synced domestic leagues — straight from the standings.
 * Followed clubs are highlighted INSIDE the table (star + row tint); there is
 * no separate "your clubs" rail above it, and with no picks the screen simply
 * shows the league the default tab lands on.
 */

/**
 * Zone rules per big-five league, position ranges → zone. The standings feed
 * carries no promotion/relegation metadata, so these are this app's own map —
 * change the ranges here, not the table. Cups and group tables get no bars.
 */
const ZONES: Record<string, Record<Zone, [number, number]>> = {
  "eng.1": { ucl: [1, 4], uel: [5, 5], relegation: [18, 20] },
  "esp.1": { ucl: [1, 4], uel: [5, 6], relegation: [18, 20] },
  "ita.1": { ucl: [1, 4], uel: [5, 6], relegation: [18, 20] },
  "ger.1": { ucl: [1, 4], uel: [5, 5], relegation: [17, 18] },
  "fra.1": { ucl: [1, 3], uel: [4, 4], relegation: [17, 18] },
};

type Zone = "ucl" | "uel" | "relegation";

const ZONE_COLOR: Record<Zone, string> = {
  ucl: "#3b82f6", // Champions League blue
  uel: "#f97316", // Europa League orange
  relegation: "var(--danger)", // relegation red
};

function zoneOf(leagueSlug: string, rank: number | null): Zone | null {
  const rules = ZONES[leagueSlug];
  if (!rules || rank == null) return null;
  for (const zone of Object.keys(rules) as Zone[]) {
    const [from, to] = rules[zone];
    if (rank >= from && rank <= to) return zone;
  }
  return null;
}

/** The big-five alias a tab value maps to, for the zone lookup. */
const ALIAS_SLUG: Record<string, string> = {
  PL: "eng.1",
  LL: "esp.1",
  SA: "ita.1",
  BL: "ger.1",
  L1: "fra.1",
};

/** Small coloured dot + label for the legend line under the table. */
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 flex-none rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}
    </span>
  );
}

/**
 * Horizontally scrollable league tabs with a fade on the edge where more tabs
 * hide. The fade is a sticky gradient at the visual INLINE-END, which flips
 * with direction — correct side for both RTL and LTR (the same trick the
 * Segmented control uses).
 */
function LeagueTabRow({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  const { dir } = useI18n();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(true);
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const check = () => setOverflows(track.scrollWidth > track.clientWidth + 2);
    check();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(check) : null;
    observer?.observe(track);
    return () => observer?.disconnect();
  }, [tabs.length]);

  return (
    <div ref={trackRef} role="tablist" className="relative flex gap-1.5 overflow-x-auto py-1">
      {overflows ? (
        <span
          aria-hidden="true"
          className="pointer-events-none sticky end-0 z-10 shrink-0"
          style={{
            width: 20,
            marginInlineEnd: -8,
            background:
              dir === "rtl"
                ? "linear-gradient(to left, transparent, var(--bg-base))"
                : "linear-gradient(to right, transparent, var(--bg-base))",
          }}
        />
      ) : null}
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => {
            if (value !== tab.value) haptic("light");
            onChange(tab.value);
          }}
          className={cx(
            "flex h-9 flex-none items-center rounded-full border px-3.5 text-xs font-bold transition-[color,border-color,background-color] duration-[var(--t-fast)]",
            value === tab.value
              ? "border-transparent bg-volt text-black"
              : "border-line bg-surface text-ink-2 hover:bg-elevated hover:text-ink",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export default function Table() {
  const { t, lang } = useI18n();
  const { teams: clubs, isFavorite } = useFavorites();
  const tabs = useLeagueTabs();
  const [league, setLeague] = useState<string | null>(null);
  // Actual / Expected view: renders ONLY when a league has xPts coverage —
  // a switch with a single choice is chrome, not a control (the old
  // single-option "جدول" pill is gone).
  const [view, setView] = useState<"actual" | "expected">("actual");

  // The sticky column header's offset is the live topbar's height, measured
  // once so the pinned header slides in just under the header band (the band
  // height varies with the title/subtitle it carries).
  const [stickyTop, setStickyTop] = useState(56);
  useEffect(() => {
    const header = document.querySelector("header");
    if (header instanceof HTMLElement) setStickyTop(header.offsetHeight + 1);
  }, []);

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
  // them — so "no data" is a normal state here, never an error.
  const hasExpected = rows.some((row) => row.xpts != null);
  // Guard the view itself too: if it somehow renders without data, fall back
  // to the real table instead of a grid of dashes.
  const showExpected = view === "expected" && hasExpected;
  // Ranked by xPts, with the uncovered clubs parked below in table order
  // (Array#sort is stable) rather than dropped or given a fake rank.
  const expectedRows = useMemo(() => [...rows].sort((a, b) => (b.xpts ?? -1) - (a.xpts ?? -1)), [rows]);

  // League heading, far end: "هفته ۸" — locale digits throughout.
  const weekFormatter = useMemo(
    () => new Intl.NumberFormat(lang === "fa" ? "fa-IR" : "en", { useGrouping: false }),
    [lang],
  );
  const gwLabel = standingsQuery.data?.length
    ? t("table.gw", { gw: weekFormatter.format(standingsQuery.data[0]?.played ?? 0) })
    : null;
  const zoneSlug = ALIAS_SLUG[active] ?? active;

  return (
    <>
      <TopBar title={t("table.title")} />

      {/* League tabs — scrollable when crowded, faded at the hidden edge. */}
      <div className="mt-md">
        <LeagueTabRow tabs={tabs} value={active} onChange={setLeague} />
      </div>

      <section className="mt-lg">
        {isCup(slug) ? (
          <CupView slug={slug} rows={rows} stickyTop={stickyTop} />
        ) : (
          <>
            <SectionHeading
              title={tabLabel(active)}
              action={
                gwLabel ? (
                  <span className="text-xs font-bold text-ink-3">
                    <Num>{gwLabel}</Num>
                  </span>
                ) : null
              }
            />
            {standingsQuery.isLoading ? (
              <RowSkeleton rows={8} />
            ) : standingsQuery.isError ? (
              <ErrorState onRetry={() => standingsQuery.refetch()} />
            ) : rows.length === 0 ? (
              <EmptyState title={t("table.emptyTitle")} hint={t("table.emptyHint")} />
            ) : (
              <>
                {hasExpected ? (
                  <div className="mb-2">
                    <Segmented
                      value={view}
                      onChange={setView}
                      options={[
                        { value: "actual", label: t("table.viewActual") },
                        { value: "expected", label: t("table.viewExpected") },
                      ]}
                    />
                  </div>
                ) : null}

                {showExpected ? (
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
                ) : null}

                {view === "actual" ? (
                  <>
                    {/* overflow-clip (not hidden) clips the card's corners while
                        staying a NON-scroll container, so the sticky header
                        inside still pins to the page scroll. */}
                    <div className="overflow-clip rounded-card border border-line bg-surface">
                      <StandingsHeader stickyTop={stickyTop} />
                      <ul className="divide-y divide-line">
                        {rows.map((row, index) => (
                          <StandingItem
                            key={row.team.id}
                            row={row}
                            index={index}
                            mine={isFavorite(row.team.id)}
                            zone={zoneOf(zoneSlug, row.rank ?? index + 1)}
                          />
                        ))}
                      </ul>
                    </div>
                    {/* Zone legend: one small line, same order as the bars. */}
                    {ZONES[zoneSlug] ? (
                      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                        <LegendDot color={ZONE_COLOR.ucl} label={t("league.UCL")} />
                        <LegendDot color={ZONE_COLOR.uel} label={t("league.UEL")} />
                        <LegendDot color={ZONE_COLOR.relegation} label={t("table.zoneReleg")} />
                      </p>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </>
        )}
      </section>
    </>
  );
}

/**
 * Six columns — Rank, Team, P, GD, Pts, Form — across a 390px phone. The old
 * eleven-column grid carried W/D/L and GF/GA too, needed `min-w-[640px]` and
 * pushed Pts and Form off-screen behind a sideways scroll; those extra figures
 * live on the club page's Stats tab. The width string must stay ONE complete
 * literal so Tailwind can see it: 1.25rem rank, flexible team, then
 * 1.5/1.75/2rem, and 5rem for the form strip (5×14px squares + 4×2px gaps
 * = 78px, inside the 80px column so nothing clips). The numeric columns and
 * the gap are deliberately one step tighter than the first draft of this grid:
 * every pixel they give up goes to the team name, which is the only column
 * that truncates — measured on a 390px phone, the name cell now has MORE room
 * than before the form column grew (96px of text vs 92px).
 */
const COLS = "grid-cols-[1.25rem_minmax(0,1fr)_1.5rem_1.75rem_2rem_5rem]";

function StandingsHeader({ stickyTop }: { stickyTop: number }) {
  const { t } = useI18n();
  return (
    <div
      aria-hidden="true"
      className={cx(
        "grid",
        COLS,
        "sticky z-10 gap-1 border-b border-line bg-elevated px-3 py-2 text-xs font-bold text-ink-3",
      )}
      style={{ top: stickyTop }}
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

function StandingItem({
  row,
  index,
  mine,
  zone,
}: {
  row: StandingRow;
  index: number;
  mine: boolean;
  zone: Zone | null;
}) {
  const { localize, lang } = useI18n();
  // Persian digits: every figure renders through locale formatting — fa-IR
  // gives the Persian-Indic glyphs (۱, +۱۱, ٫ separator for decimals); EN
  // keeps Latin digits and the counting animation.
  const fmt = (v: number, decimals = 0) =>
    new Intl.NumberFormat(lang === "fa" ? "fa-IR" : "en", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(v);
  const gd = (row.goalsFor ?? 0) - (row.goalsAgainst ?? 0);
  const rank = row.rank ?? index + 1;
  return (
    <li
      className={cx(
        "list-in relative grid",
        COLS,
        "items-center gap-1 px-3 py-2 transition-[background-color,transform] duration-[var(--t-fast)] active:scale-[0.99]",
        mine ? "bg-elevated" : "hover:bg-elevated/60",
      )}
      style={{ "--stagger": `${Math.min(index, 8) * 40}ms` } as CSSProperties}
    >
      {/* Zone bar: a 3px pill on the row's START edge (flips with direction),
          coloured by the zone's rule. */}
      {zone ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-1.5 start-0 w-[3px] rounded-full"
          style={{ backgroundColor: ZONE_COLOR[zone] }}
        />
      ) : null}
      <Num className={cx("text-sm", mine ? "text-volt" : rank <= 3 ? "text-gold" : "text-ink-3")}>
        {fmt(rank)}
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
      <Num className="text-end text-xs text-ink-3">
        {row.played == null ? "–" : fmt(row.played)}
      </Num>
      <Num className={cx("text-end text-xs", gd >= 0 ? "text-ink-2" : "text-ink-3")}>
        {gd > 0 ? `+${fmt(gd)}` : fmt(gd)}
      </Num>
      {row.points != null ? (
        lang === "fa" ? (
          <Num className="text-end text-sm font-extrabold text-ink">{fmt(row.points)}</Num>
        ) : (
          <CountUp value={row.points} className="text-end text-sm font-extrabold text-ink" />
        )
      ) : (
        <Num className="text-end text-sm font-extrabold text-ink">–</Num>
      )}
      {row.form ? <FormStrip form={row.form} /> : <span className="text-end text-xs text-ink-3">–</span>}
    </li>
  );
}

/**
 * The last five results, oldest first. On the Table page the server folds them
 * from the stored finished matches (server/standings/form.ts), so the strip
 * always matches the fixtures the club page shows; MatchDetail's Form tab feeds
 * it the per-match ESPN form instead. Either way a club with fewer than five
 * finished matches simply carries fewer squares.
 *
 * Squares, not dots: 14px with a tinted fill, a 1px inset ring for definition
 * on the dark surface and the result letter inside, so the form reads as
 * W / D / L (ب / ت / خ in Persian) instead of five colours to decode. One image
 * for screen readers, so the label reads as a sentence instead of five stray
 * letters; `dir="ltr"` keeps the order oldest→newest in Farsi too.
 *
 * Exported because MatchDetail's Form tab and the club page's header render
 * the very same strip.
 */
export function FormStrip({ form }: { form: string }) {
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
      className="flex flex-none items-center justify-end gap-0.5"
    >
      {results.map((result, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={cx(
            "grid h-3.5 w-3.5 place-items-center rounded-md text-[10px] font-bold leading-none",
            result === "W"
              ? "bg-pitch/20 text-pitch ring-1 ring-inset ring-pitch/40"
              : result === "L"
                ? "bg-danger/20 text-danger ring-1 ring-inset ring-danger/40"
                : "bg-ink-3/15 text-ink-3 ring-1 ring-inset ring-ink-3/30",
          )}
        >
          {result === "W"
            ? t("table.formWShort")
            : result === "L"
              ? t("table.formLShort")
              : t("table.formDShort")}
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
  const { t, localize, lang } = useI18n();
  const fmt = (v: number, decimals = 0) =>
    new Intl.NumberFormat(lang === "fa" ? "fa-IR" : "en", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(v);
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
      <Num className="text-xs text-ink-3">{rank == null ? "–" : fmt(rank)}</Num>
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
      <Num className="text-end text-xs text-ink-3">
        {row.played == null ? "–" : fmt(row.played)}
      </Num>
      {/* The header grid is decorative (aria-hidden, as in the real table), so
          every figure names itself; the wrappers keep the cell count even. */}
      <span className="text-end">
        {expected != null ? (
          lang === "fa" ? (
            <Num className="text-xs font-bold text-gold">{fmt(expected, 1)}</Num>
          ) : (
            <CountUp value={expected} decimals={1} className="text-xs font-bold text-gold" />
          )
        ) : (
          <Num className="text-xs font-bold text-gold">–</Num>
        )}
        <span className="sr-only"> {t("table.xpts")}</span>
      </span>
      <span className="text-end">
        {actual != null ? (
          lang === "fa" ? (
            <Num className="text-xs text-ink">{fmt(actual)}</Num>
          ) : (
            <CountUp value={actual} className="text-xs text-ink" />
          )
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
          {delta == null ? "–" : `${delta >= 0 ? "+" : ""}${fmt(Math.abs(delta), 1)}`}
        </Num>
        <span className="sr-only"> {t("xg.expected")}</span>
      </span>
    </li>
  );
}

function CupView({
  slug,
  rows,
  stickyTop,
}: {
  slug: string;
  rows: StandingRow[];
  stickyTop: number;
}) {
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
            {/* Group tables share the league's six columns; no zone bars. */}
            <div className="overflow-clip rounded-card border border-line bg-surface">
              <StandingsHeader stickyTop={stickyTop} />
              <ul className="divide-y divide-line">
                {groupRows.map((row, index) => (
                  <StandingItem
                    key={row.team.id}
                    row={row}
                    index={index}
                    mine={isFavorite(row.team.id)}
                    zone={null}
                  />
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
          <ul className="space-y-sm">
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
