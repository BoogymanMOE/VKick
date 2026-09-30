import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { CompRowSkeleton, MatchCardSkeleton } from "../components/Skeletons";
import { Chip, EmptyState, ErrorState, LiveDot, Num, SectionHeading, Segmented } from "../components/ui";
import { useKnockoutCompetitions, useMatches } from "../hooks/useApi";
import { useI18n } from "../i18n/I18nProvider";
import { formatKickoff } from "../lib/format";
import { haptic } from "../lib/telegram";
import { PlayIcon } from "../components/icons";
import type { Match } from "../types";

/**
 * Knockout competitions: live scores and fixtures for the club cups — the three
 * UEFA competitions, UCL qualifying and the Super Cup, plus the big five's six
 * domestic cups — and the international tournaments (national teams). Sourced
 * from the same sync as the leagues and selected on the server's `kind`
 * (anything that is not a league), so promoting a competition into the catalog
 * adds it here with no client change. No table here — knockout only.
 *
 * A small Cups / International toggle swaps the competition strip, because one
 * fifteen-item scroller mixing club cups with World Cup qualifying is hard to
 * find things in. The toggle follows a deep link, so Browse's tournament rows
 * open straight onto the International tab.
 */
export default function Cups() {
  const { t, localize } = useI18n();

  const compsQuery = useKnockoutCompetitions();
  const comps = compsQuery.data ?? [];
  const [searchParams] = useSearchParams();
  const [picked, setPicked] = useState<string | null>(null);
  const [kind, setKind] = useState<"cup" | "tournament" | null>(null);

  // Deep link from Browse (?cup=uefa.champions) wins until the user picks one.
  // Default: the Champions League until the picker loads.
  const linked = searchParams.get("cup");
  const active = picked ?? linked ?? comps[0]?.slug ?? "uefa.champions";
  // The toggle follows whatever competition is active, so Browse's tournament
  // rows open onto International instead of an empty club-cup strip.
  const tab = (kind ?? comps.find((c) => c.slug === active)?.kind ?? "cup") as "cup" | "tournament";
  const visible = comps.filter((c) => c.kind === tab);
  const matchesQuery = useMatches({ league: active });
  // Memoized so the identity stays stable across renders: the derived `byRound`
  // map below depends on it, and a fresh `[]` every render would rebuild it.
  const matches = useMemo(() => matchesQuery.data ?? [], [matchesQuery.data]);

  const live = matches.filter((m) => m.status === "live");
  const scheduled = matches.filter((m) => m.status === "scheduled");
  const finished = matches.filter((m) => m.status === "finished");

  // Knockout structure from the sync's round labels. Every match in the window
  // carries its round ("Quarter-final"…), so the sections render as a mini
  // bracket — first round at the top, the final last — instead of one flat
  // fixture list. Cups with no round data (early qualifying) fall back to the
  // status sections below, unchanged.
  const byRound = useMemo(() => {
    if (matchesQuery.isLoading || matchesQuery.isError) return new Map<string, Match[]>();
    const map = new Map<string, Match[]>();
    for (const m of matches) {
      const key = m.round?.trim();
      // Live matches surface once, in the live section above the bracket —
      // they don't repeat inside their round group.
      if (key && m.status !== "live") {
        const list = map.get(key);
        if (list) list.push(m);
        else map.set(key, [m]);
      }
    }
    return map;
  }, [matches, matchesQuery.isLoading, matchesQuery.isError]);
  const roundOrder = useMemo(
    () =>
      [...byRound.keys()].sort(
        // Descending rank: qualifying/early rounds first, the Final last —
        // the bracket reads in the order the cup is actually played.
        (a, b) => roundRank(b) - roundRank(a) || a.localeCompare(b),
      ),
    [byRound],
  );

  return (
    <>
      <TopBar title={t("cups.title")} subtitle={t("cups.subtitle")} />

      {compsQuery.isLoading ? (
        <RowPlaceholder />
      ) : (
        <div className="mt-3 space-y-2">
          <Segmented
            value={tab}
            onChange={(next) => {
              haptic("light");
              setKind(next);
              const first = comps.find((c) => c.kind === next);
              if (first) setPicked(first.slug);
            }}
            options={[
              { value: "cup", label: t("browse.cups") },
              { value: "tournament", label: t("browse.tournaments") },
            ]}
          />
          <Segmented
            value={active}
            onChange={(next) => {
              haptic("light");
              setPicked(next);
            }}
            options={visible.map((c) => ({ value: c.slug, label: localize(c.name) }))}
          />
        </div>
      )}

      {byRound.size > 0 ? (
        /* Round structure when the sync carries it: live first, then the
           bracket from the first round to the final. */
        <>
          {matchesQuery.isLoading ? (
            <ul className="mt-4 space-y-2">
              <MatchCardSkeleton />
            </ul>
          ) : null}
          {matchesQuery.isError ? (
            <div className="mt-4">
              <ErrorState onRetry={() => matchesQuery.refetch()} />
            </div>
          ) : null}
          {live.length > 0 ? (
            <section className="mt-4">
              <SectionHeading
                title={t("matches.live")}
                action={
                  <Chip tone="live">
                    <LiveDot />
                    <Num>{live.length}</Num>
                  </Chip>
                }
              />
              <CupMatchList matches={live} />
            </section>
          ) : null}
          {roundOrder.map((round) => {
            const list = byRound.get(round)!;
            return (
              <section className="mt-6" key={round}>
                <SectionHeading
                  title={localize(round)}
                  action={
                    <Chip tone="muted">
                      <Num>{list.length}</Num>
                    </Chip>
                  }
                />
                <CupMatchList matches={list} />
              </section>
            );
          })}
        </>
      ) : (
        /* No round labels in the window: the original status sections. */
        <>
          <section className="mt-4">
            <SectionHeading
              title={t("matches.live")}
              action={
                live.length > 0 ? (
                  <Chip tone="live">
                    <LiveDot />
                    <Num>{live.length}</Num>
                  </Chip>
                ) : null
              }
            />
            {matchesQuery.isLoading ? (
              <ul className="space-y-2">
                <MatchCardSkeleton />
              </ul>
            ) : matchesQuery.isError ? (
              <ErrorState onRetry={() => matchesQuery.refetch()} />
            ) : live.length > 0 ? (
              <CupMatchList matches={live} />
            ) : (
              <EmptyState
                title={t("cups.empty")}
                hint={t("cups.emptyHint")}
                action={
                  <button
                    type="button"
                    onClick={() => {
                      haptic("light");
                      matchesQuery.refetch();
                    }}
                    className="min-h-11 rounded-full border border-volt px-5 text-xs font-bold text-volt transition-colors duration-[var(--t-fast)] hover:bg-elevated"
                  >
                    {t("common.retry")}
                  </button>
                }
              />
            )}
          </section>

          <section className="mt-6">
            <SectionHeading title={t("matches.upcoming")} />
            {scheduled.length > 0 ? (
              <CupMatchList matches={scheduled} />
            ) : (
              <EmptyState title={t("cups.empty")} hint={t("cups.emptyHint")} />
            )}
          </section>

          <section className="mt-6">
            <SectionHeading title={t("matches.finished")} />
            {finished.length > 0 ? (
              <CupMatchList matches={finished} />
            ) : (
              <EmptyState title={t("cups.empty")} hint={t("cups.emptyHint")} />
            )}
          </section>
        </>
      )}

      <p className="mt-6 text-center text-[11px] text-ink-3">{t("cups.noTable")}</p>
    </>
  );
}

/**
 * Cup fixture row: teams, score/clock, replay affordance. The whole footer is
 * the touch surface — summary and replay links meet the 44px floor inside it.
 */
function CupMatchList({ matches }: { matches: Match[] }) {
  const { t, lang, localize } = useI18n();
  return (
    <ul className="space-y-2">
      {matches.map((match) => (
        <li key={match.id} className="rounded-card border border-line bg-surface p-3">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-end text-sm font-bold text-ink">
              {localize(match.home.shortName)}
            </span>
            <span className="flex-none">
              {match.status === "live" ? (
                <Chip tone="live">
                  <LiveDot />
                  <Num>{match.minute ?? ""}</Num>
                </Chip>
              ) : match.status === "finished" ? (
                <Chip tone="muted">
                  <Num>
                    {match.homeScore ?? 0}–{match.awayScore ?? 0}
                  </Num>
                </Chip>
              ) : (
                <Chip tone="volt">
                  <Num>{formatKickoff(new Date(match.kickoffAt), lang === "fa" ? "fa-IR" : undefined)}</Num>
                </Chip>
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
              {localize(match.away.shortName)}
            </span>
          </div>
          <div className="mt-2 flex min-h-11 items-center justify-end gap-4 border-t border-line pt-1">
            <Link
              to={`/match/${match.id}`}
              className="inline-flex h-11 items-center text-[11px] font-bold text-ink-2 transition-colors duration-[var(--t-fast)] hover:text-ink"
            >
              {t("match.summary")}
            </Link>
            {match.status === "finished" ? (
              <Link
                to={`/match/${match.id}/replay`}
                className="inline-flex h-11 items-center gap-1 text-[11px] font-bold text-volt"
              >
                <PlayIcon />
                {t("replay.title")}
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Bracket order for round headings: Final last, semis before it, then the
 * earlier rounds. Ties fall back to alphabetical so any unexpected label
 * still groups deterministically.
 */
function roundRank(label: string): number {
  const l = label.toLowerCase();
  // Order matters: "quarter-final" and "semi-final" both contain "final".
  if (l.includes("semi")) return 1;
  if (l.includes("quarter")) return 2;
  if (l.includes("final") && !l.includes("qual")) return 0;
  const n = parseInt(l.match(/(?:round of|round)\s*(\d+)$/)?.[1] ?? "", 10);
  if (!Number.isNaN(n)) return 2 + n; // Round of 16 → 18, of 32 → 34…
  if (l.includes("round")) return 40; // unnumbered rounds after the numbered ones
  if (l.includes("qual") || l.includes("play")) return 60; // qualifying last
  return 50;
}

function RowPlaceholder() {
  return <CompRowSkeleton rows={3} />;
}
