import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { CompRowSkeleton, MatchCardSkeleton } from "../components/Skeletons";
import {
  Chip,
  CollapsibleSection,
  EmptyState,
  ErrorState,
  LiveDot,
  Num,
  SectionHeading,
  Segmented,
} from "../components/ui";
import { buildBracket, type BracketTie } from "../lib/bracket";
import { useKnockoutCompetitions, useMatches } from "../hooks/useApi";
import { useI18n } from "../i18n/I18nProvider";
import { formatKickoff } from "../lib/format";
import { haptic } from "../lib/telegram";
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

  // Bulk expand/collapse for the bracket rounds. null = no override, so every
  // round uses its own persisted fold state; the control only shows when
  // there's a bracket, and flips back to null whenever a round is toggled
  // singly (the override is transient, the per-round choice is the truth).
  const [roundsOverride, setRoundsOverride] = useState<boolean | null>(null);

  // Knockout structure from the sync's round labels: rounds in play order,
  // two-legged pairings folded into one tie with an aggregate, winners
  // inferred (honestly undecided when penalties decided a level tie), and
  // feeder links connecting each tie back to the round that produced it —
  // that is what turns five flat fixture lists into one bracket. Cups with
  // no round data fall back to the status sections below, unchanged.
  const bracket = useMemo(() => {
    if (matchesQuery.isLoading || matchesQuery.isError) return { rounds: [], connected: false };
    return buildBracket(matches);
  }, [matches, matchesQuery.isLoading, matchesQuery.isError]);

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

      {bracket.rounds.length > 0 ? (
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
          {bracket.rounds.length > 1 ? (
            // Bulk control for the bracket: folds or unfolds every round at
            // once. The label names the action ahead — "Expand all" once the
            // rounds are collapsed, "Collapse all" otherwise.
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  haptic("light");
                  setRoundsOverride((prev) => (prev === null ? false : !prev));
                }}
                className="inline-flex min-h-11 items-center rounded-full border border-line px-3 text-[11px] font-bold text-ink-2 transition-colors duration-[var(--t-fast)] hover:bg-elevated hover:text-ink"
              >
                {roundsOverride === false ? t("common.expandAll") : t("common.collapseAll")}
              </button>
            </div>
          ) : null}
          {bracket.rounds.map((round) => {
            const legCount = round.ties.reduce((n, tie) => n + tie.legs.length, 0);
            return (
              // Collapsible like the status sections; the fold state keys off
              // the round label, so collapsing "Qualifying" once keeps it
              // folded in every cup. Toggling one round releases the bulk
              // override so the per-round choice is the ongoing truth.
              <CollapsibleSection
                key={round.label}
                id={`cups-round-${roundId(round.label)}`}
                level={2}
                title={localize(round.label)}
                count={legCount}
                openOverride={roundsOverride === null ? undefined : { open: roundsOverride }}
                onUserToggle={roundsOverride === null ? undefined : () => setRoundsOverride(null)}
              >
                <div className="space-y-2">
                  {round.ties.map((tie) => (
                    <TieCard key={tie.key} tie={tie} />
                  ))}
                </div>
              </CollapsibleSection>
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

          <CollapsibleSection
            id="cups-finished"
            level={2}
            title={t("matches.previous")}
            count={finished.length}
          >
            {finished.length > 0 ? (
              <CupMatchList matches={finished} />
            ) : (
              <EmptyState title={t("cups.empty")} hint={t("cups.emptyHint")} />
            )}
          </CollapsibleSection>
        </>
      )}

      <p className="mt-6 text-center text-[11px] text-ink-3">{t("cups.noTable")}</p>
    </>
  );
}

/**
 * Cup fixture row: teams, score/clock, summary link. The whole footer is
 * the touch surface — the link meets the 44px floor inside it.
 * In `bare` mode the row drops its own card chrome: a TieCard supplies the
 * border and the rows become the tie's legs, separated by hairlines.
 */
function CupMatchList({ matches, bare = false }: { matches: Match[]; bare?: boolean }) {
  const { t, lang, localize } = useI18n();
  return (
    <ul className={bare ? undefined : "space-y-2"}>
      {matches.map((match) => (
        <li
          key={match.id}
          className={
            bare
              ? "border-t border-line px-3 py-2 first:border-t-0"
              : "rounded-card border border-line bg-surface p-3"
          }
        >
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
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * One tie of the bracket — the node that connects rounds. The card carries
 * the pairing's aggregate header when the tie spans two legs, the legs
 * themselves (bare rows), and a footer that states what the data proves:
 * who advances (an honest "undecided" when penalties decided a level tie)
 * and which round the participants came from — the visible edge of the tree.
 * A first-round tie with nothing to say renders as a plain fixture card.
 */
function TieCard({ tie }: { tie: BracketTie }) {
  const { t, localize } = useI18n();
  const twoLegs = tie.legs.length > 1;
  const showFooter = twoLegs || tie.winnerId != null || tie.feedRound != null;
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      {twoLegs ? (
        <div className="flex items-center gap-2 border-b border-line bg-elevated px-3 py-2">
          <span className="min-w-0 flex-1 truncate text-end text-xs font-bold text-ink">{tie.homeName}</span>
          <span className="label flex-none text-ink-3">
            {t("cups.tieAgg")}{" "}
            <Num className="text-xs text-ink">
              {tie.aggHome ?? "–"}–{tie.aggAway ?? "–"}
            </Num>
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-bold text-ink">{tie.awayName}</span>
        </div>
      ) : null}
      <CupMatchList matches={tie.legs} bare />
      {showFooter ? (
        <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-[11px]">
          {tie.winnerId ? (
            <span className="min-w-0 truncate font-bold text-volt">
              <span aria-hidden="true">→ </span>
              {tie.winnerName}
              <span className="sr-only"> — {t("cups.winnerAdvances")}</span>
            </span>
          ) : (
            <span className="text-ink-3">{t("cups.tiePending")}</span>
          )}
          {tie.feedRound ? (
            <span className="flex-none text-ink-3">
              <span aria-hidden="true">← </span>
              {localize(tie.feedRound)}
              <span className="sr-only"> — {t("cups.feedsFrom", { round: localize(tie.feedRound) })}</span>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Stable, DOM-id-safe key for a round label, so its fold state survives
 * reloads and is shared across cups with the same round naming. Latin labels
 * slugify ("Quarter-final" → "quarter-final"); anything else (Persian round
 * names) falls back to a deterministic hash so the id is still valid HTML and
 * unique.
 */
function roundId(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug) return slug;
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) | 0;
  }
  return `r${(hash >>> 0).toString(36)}`;
}

function RowPlaceholder() {
  return <CompRowSkeleton rows={3} />;
}
