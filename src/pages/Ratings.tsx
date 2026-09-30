import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RateSheet } from "../components/panels/RateSheet";
import { RatingRow } from "../components/RatingRow";
import { RowSkeleton } from "../components/Skeletons";
import { TopBar } from "../components/TopBar";
import { Card, Chip, EmptyState, ErrorState, SectionHeading, Segmented } from "../components/ui";
import { api, serverErrorKey } from "../lib/api";
import { TEAM_FALLBACK } from "../lib/colors";
import { leagueIdOf, useMatches } from "../hooks/useApi";
import { useI18n } from "../i18n/I18nProvider";
import type { PlayerRating } from "../types";
import { haptic, notifyHaptic } from "../lib/telegram";
import { useToast } from "../components/Toast";
import type { StringKey } from "../i18n/strings";
import { useSearchParams, Link } from "react-router-dom";

/**
 * The eye test across your matches: latest finished (or live) match first,
 * real crowd ratings beside the stat score. Rating writes go to the server.
 */
export default function Ratings() {
  const { t, localize } = useI18n();
  const [params, setParams] = useSearchParams();
  const matchesQuery = useMatches();
  const matches = matchesQuery.data ?? [];

  // The match whose rating sheet is open (deep-linkable via ?match=).
  const requested = params.get("match");
  const openMatchId = requested ?? (matches.find((m) => m.status === "finished") ?? matches[0])?.id ?? "";
  const openMatch = matches.find((m) => m.id === openMatchId);

  const setMatchParam = (id: string) =>
    setParams(
      (prev) => {
        prev.set("match", id);
        prev.delete("rate");
        return prev;
      },
      { replace: true },
    );

  const finished = matches.filter((m) => m.status !== "scheduled").slice(0, 8);

  return (
    <>
      <TopBar title={t("ratings.title")} subtitle={t("ratings.subtitle")} />

      {finished.length > 1 ? (
        <div className="mt-3">
          <Segmented
            value={openMatchId}
            onChange={setMatchParam}
            options={finished.map((m) => ({
              value: m.id,
              label: `${localize(m.home.shortName)}–${localize(m.away.shortName)}`,
            }))}
          />
        </div>
      ) : null}

      {matchesQuery.isLoading ? (
        <div className="mt-3">
          <RowSkeleton rows={6} />
        </div>
      ) : !openMatch ? (
        <div className="mt-3">
          <EmptyState
            title={t("ratings.emptyTitle")}
            hint={t("ratings.emptyHint")}
            action={
              <Link
                to="/matches"
                className="min-h-11 rounded-full border border-volt px-5 text-xs font-bold leading-[2.75rem] text-volt transition-colors duration-[var(--t-fast)] hover:bg-elevated"
              >
                {t("ratings.emptyAction")}
              </Link>
            }
          />
        </div>
      ) : (
        <MatchRatings matchId={openMatch.id} match={toRawMatch(openMatch)} />
      )}
    </>
  );
}

function toRawMatch(m: NonNullable<ReturnType<typeof useMatches>["data"]>[number]) {
  return m;
}

function MatchRatings({
  matchId,
  match,
}: {
  matchId: string;
  match: { status: string; home: { shortName: string }; away: { shortName: string } } | undefined;
}) {
  const { t, localize } = useI18n();
  const { push } = useToast();
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["ratings", matchId],
    queryFn: () => api.getRatings(matchId),
    refetchInterval: match?.status === "live" ? 30_000 : false,
  });
  const players = (query.data?.players ?? []).map(adapt);
  const cardsUsed = query.data?.cardsUsed ?? 0;
  const cardsMax = query.data?.cardsMax ?? 3;
  const [sort, setSort] = useState<"crowd" | "points" | "divergence">("crowd");

  const sheetFor = players.find((row) => row.playerId === params.get("rate")) ?? null;
  const setSheetFor = (player: PlayerRating | null) =>
    setParams(
      (prev) => {
        if (player) prev.set("rate", player.playerId);
        else prev.delete("rate");
        return prev;
      },
      { replace: true },
    );

  type RatingsData = Awaited<ReturnType<typeof api.getRatings>>;

  const rate = useMutation({
    mutationFn: (input: { playerId: string; value: number; comment?: string }) =>
      api.ratePlayer(matchId, input.playerId, input.value, input.comment),
    // Optimistic: the row shows the user's score the moment they save — no
    // round-trip wait. Rollback restores the server list on failure.
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["ratings", matchId] });
      const prev = queryClient.getQueryData<RatingsData>(["ratings", matchId]);
      if (prev) {
        const target = prev.players.find((p) => p.player_id === input.playerId);
        const wasNew = target?.my_rating == null;
        queryClient.setQueryData<RatingsData>(["ratings", matchId], {
          ...prev,
          cardsUsed: wasNew ? Math.min(prev.cardsMax, prev.cardsUsed + 1) : prev.cardsUsed,
          players: prev.players.map((p) =>
            p.player_id === input.playerId
              ? {
                  ...p,
                  my_rating: input.value,
                  my_comment: input.comment ?? p.my_comment ?? null,
                  votes: wasNew ? p.votes + 1 : p.votes,
                }
              : p,
          ),
        });
      }
      return { prev };
    },
    onSuccess: () => {
      // Server truth (crowd average, real vote counts) replaces the optimistic row.
      void queryClient.invalidateQueries({ queryKey: ["ratings", matchId] });
    },
    onError: (err, _input, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["ratings", matchId], ctx.prev);
      // e.g. "player did not feature" or the 3-card cap — localized, not raw.
      notifyHaptic("error");
      push({ text: t(serverErrorKey(err) as StringKey), tone: "danger", icon: "✕" });
    },
  });

  // The whole point of the feature: players the crowd rates highly but who
  // returned little on the stat sheet, side by side rather than merged.
  const divergence = (rating: PlayerRating) => (rating.crowdRating ?? 0) - rating.fantasyPoints / 2;

  const rows = [...players].sort((a, b) => {
    if (sort === "points") return b.fantasyPoints - a.fantasyPoints;
    if (sort === "divergence") return divergence(b) - divergence(a);
    return (b.crowdRating ?? 0) - (a.crowdRating ?? 0);
  });

  if (query.isLoading) return <RowSkeleton rows={6} />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  if (players.length === 0) return <EmptyState title={t("ratings.noneYet")} hint={t("ratings.noneHint")} />;

  return (
    <>
      <Card className="mt-3 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-xs text-ink-2">
              {localize(match?.home.shortName ?? "")} {t("common.versus")}{" "}
              {localize(match?.away.shortName ?? "")}
            </p>
            <p className="mt-0.5 text-xs text-ink-3">
              {t("ratings.cards", { used: cardsUsed, max: cardsMax })} · {t("ratings.pickThree")}
            </p>
          </div>
          <Chip tone="gold">{t("ratings.eyeTest")}</Chip>
        </div>
      </Card>

      <div className="mt-4">
        <Segmented
          value={sort}
          onChange={setSort}
          options={[
            { value: "crowd", label: t("ratings.sortCrowd") },
            { value: "points", label: t("ratings.sortPoints") },
            { value: "divergence", label: t("ratings.sortGap") },
          ]}
        />
      </div>

      <section className="mt-4">
        <SectionHeading
          title={t("match.tabRatings")}
          action={<span className="text-[11px] text-ink-3">{t("ratings.tapToRate")}</span>}
        />
        <ul className="mt-2 space-y-2">
          {rows.map((rating) => (
            <RatingRow
              key={rating.playerId}
              rating={rating}
              team={rating._team}
              onTap={(player) => {
                // 3-card cap: block a brand-new card when full, edits stay open.
                if (cardsUsed >= cardsMax && player.myRating === null) return;
                setSheetFor(player);
              }}
            />
          ))}
        </ul>
      </section>

      {sheetFor ? (
        <RateSheet
          rating={sheetFor}
          open
          onClose={() => setSheetFor(null)}
          distribution={distributionFromVotes(sheetFor)}
          cardsUsed={cardsUsed}
          cardsMax={cardsMax}
          onSave={(playerId, value, comment) => {
            haptic("medium");
            rate.mutate({ playerId, value, comment });
          }}
        />
      ) : null}
    </>
  );
}

type Team = import("../types").Team;

function adapt(p: import("../lib/api").ApiPlayerRating): PlayerRating & { _team: Team } {
  return {
    playerId: p.player_id,
    name: p.name,
    teamId: p.team_id,
    position: (p.position ?? "MID") as PlayerRating["position"],
    fantasyPoints: p.stat_score ?? 0,
    crowdRating: p.crowd_rating,
    votes: p.votes ?? 0,
    myRating: p.my_rating ?? null,
    myComment: p.my_comment ?? null,
    latestComment: p.latest_comment ?? null,
    _team: {
      id: p.team_id,
      name: p.team_name ?? "",
      shortName: p.team_short ?? p.team_name ?? "",
      abbreviation: (p.team_short ?? "").slice(0, 3) || "—",
      color: p.team_color ?? TEAM_FALLBACK,
      league: leagueIdOf("") ?? "PL",
    },
  };
}

function distributionFromVotes(rating: PlayerRating): number[] {
  const counts = Array.from({ length: 10 }, () => 0);
  if (rating.crowdRating !== null && rating.votes > 0) {
    counts[Math.min(9, Math.max(0, Math.round(rating.crowdRating) - 1))] = rating.votes;
  }
  return counts;
}
