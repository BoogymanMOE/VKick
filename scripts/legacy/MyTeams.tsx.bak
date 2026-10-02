import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../components/Toast";
import { TopBar } from "../components/TopBar";
import { ClubFixtureCard } from "../components/ClubCard";
import { Chip, ListRow, SectionHeading, TeamBadge, cx } from "../components/ui";
import { PickerTabs } from "../components/PickerTabs";
import { StreakWidget } from "../components/StreakWidget";
import { CheckIcon, ChevronLeftIcon, StarFilledIcon } from "../components/icons";
import { useTeams, useCompetitions } from "../hooks/useApi";
import { MAX_FAVORITES, useFavorites, useFollowedLeagues } from "../hooks/useFavorites";
import { useI18n } from "../i18n/I18nProvider";
import { haptic, selectionHaptic } from "../lib/telegram";
import { buildPickerGroups, teamsInGroup } from "../lib/pickerGroups";
import { serverErrorKey } from "../lib/api";
import type { StringKey } from "../i18n/strings";

/**
 * The picks hub, per the v2 concept: up to five clubs (no per-league rule,
 * exactly one anchored favorite) plus up to five followed leagues. The
 * anchor star is a long-press-free explicit tap: tap the star on any picked
 * club to make it lead the app.
 */
export default function MyTeams() {
  const { t, localize } = useI18n();
  const { push } = useToast();
  const navigate = useNavigate();
  const { teams, anchorId, count, isFavorite, toggle, setAnchor } = useFavorites();
  const followed = useFollowedLeagues();
  const [group, setGroup] = useState<string>("PL");

  // All teams in one query; filtered per picker tab. The tab list covers the
  // big five plus the cup-only and national-team groups, so clubs outside the
  // big five are reachable at all — they used to be unfollowable.
  const teamsQuery = useTeams();
  const allTeams = teamsQuery.data ?? [];
  const groupTeams = teamsInGroup(allTeams, group);

  // Tabs come from the catalog: the big five, every other league (Eredivisie,
  // Primeira Liga, MLS…), then the catch-alls — so a league promoted on the
  // server grows the picker with no client change.
  const compsQuery = useCompetitions();
  const pickerGroups = useMemo(
    () => buildPickerGroups(compsQuery.data?.competitions ?? [], (key) => t(key), localize),
    [compsQuery.data, t, localize],
  );

  function onToggle(team: (typeof allTeams)[number]) {
    const result = toggle(team);
    const name = localize(team.shortName);
    if (!result.ok) {
      haptic("medium");
      push({
        text: t(result.reason === "cap" ? "myTeams.errCap" : "common.error"),
        tone: "danger",
        icon: "✕",
      });
      return;
    }
    haptic("light");
    push({
      text: t(result.added ? "myTeams.added" : "myTeams.removed", { team: name }),
      tone: result.added ? "volt" : "muted",
      icon: result.added ? "★" : "✕",
    });
  }

  function onMakeAnchor(teamId: string, name: string) {
    if (teamId === anchorId) return;
    selectionHaptic();
    setAnchor.mutate(teamId);
    push({ text: t("onboarding.isFavorite") + " · " + name, tone: "gold", icon: "★" });
  }

  function onToggleLeague(slug: string, name: string) {
    if (followed.isFollowing(slug)) {
      followed.unfollow.mutate(slug, {
        onError: (err) => {
          haptic("medium");
          push({ text: t(serverErrorKey(err) as StringKey), tone: "danger", icon: "✕" });
        },
        onSuccess: () => {
          haptic("light");
          push({ text: `${name} · ✕`, tone: "muted", icon: "✕" });
        },
      });
      return;
    }
    if (followed.count >= 5) {
      haptic("medium");
      push({ text: t("leagues.errCap"), tone: "danger", icon: "✕" });
      return;
    }
    followed.follow.mutate(slug, {
      onError: (err) => {
        haptic("medium");
        push({ text: t(serverErrorKey(err) as StringKey), tone: "danger", icon: "✕" });
      },
      onSuccess: () => {
        haptic("light");
        push({ text: `${name} · ★`, tone: "volt", icon: "★" });
      },
    });
  }

  return (
    <>
      <TopBar title={t("myTeams.title")} subtitle={t("myTeams.subtitle", { max: MAX_FAVORITES })} />

      {/* Picked clubs, anchor first, each showing its live/next fixture. */}
      <section className="mt-3">
        <SectionHeading
          title={t("myTeams.selected")}
          action={
            <Chip tone={count >= MAX_FAVORITES ? "gold" : "volt"}>
              {t("myTeams.picked", { count, max: MAX_FAVORITES })}
            </Chip>
          }
        />
        {count > 0 ? (
          <ul className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
            {[...teams]
              .sort((a, b) => Number(b.id === anchorId) - Number(a.id === anchorId))
              .map((team) => (
                <ClubFixtureCard
                  key={team.id}
                  team={team}
                  anchored={team.id === anchorId}
                  onMakeAnchor={count > 1 ? () => onMakeAnchor(team.id, localize(team.shortName)) : undefined}
                  onRemove={() => onToggle(team)}
                />
              ))}
          </ul>
        ) : (
          <p className="rounded-card border border-dashed border-line px-3 py-4 text-center text-xs text-ink-3">
            {t("myTeams.empty")}
          </p>
        )}
        {count > 1 ? (
          <p className="mt-1 text-center text-[11px] text-ink-3">
            {t("onboarding.makeFavorite")}: <StarFilledIcon className="inline-block h-3 w-3 align-[-1px]" />
          </p>
        ) : null}
      </section>

      {/* Favorite-club streak (scoring-rules.md §6) — only with an anchor. */}
      {anchorId ? <StreakWidget className="mt-4" /> : null}

      {/* Club picker: the big five, then cup-only clubs and national teams. */}
      <PickerTabs groups={pickerGroups} value={group} onChange={setGroup} />

      <section className="mt-3">
        <ul className="grid grid-cols-2 gap-2">
          {groupTeams.map((team) => {
            const picked = isFavorite(team.id);
            return (
              <li key={team.id}>
                <button
                  type="button"
                  onClick={() => onToggle(team)}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-card border p-2.5 text-start transition-colors duration-[var(--t-fast)]",
                    picked ? "border-volt bg-elevated" : "border-line bg-surface hover:bg-elevated",
                  )}
                >
                  <TeamBadge team={team} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-ink">
                      {localize(team.shortName)}
                    </span>
                    {picked && team.id === anchorId ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-gold">
                        <StarFilledIcon className="h-2.5 w-2.5 flex-none" />
                        {t("onboarding.isFavorite")}
                      </span>
                    ) : null}
                  </span>
                  {picked ? <CheckIcon className="h-4 w-4 flex-none text-volt" /> : null}
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-center text-[11px] text-ink-3">{t("myTeams.hint")}</p>
      </section>

      <LeagueFollowing followed={followed} onToggle={onToggleLeague} />

      {/* Cups & international tournaments: browsable beyond the league picker.
          A full-width row like every other navigation here, not a floating pill. */}
      <section className="mt-4">
        <ListRow
          label={t("browse.title")}
          hint={t("browse.subtitle")}
          onClick={() => navigate("/browse")}
          right={
            <span className="flex-none text-ink-3 rtl:rotate-180" aria-hidden="true">
              <ChevronLeftIcon />
            </span>
          }
        />
      </section>
    </>
  );
}

/* ------------------------------------------------------------ league following */

type Followed = ReturnType<typeof useFollowedLeagues>;

function LeagueFollowing({
  followed,
  onToggle,
}: {
  followed: Followed;
  onToggle: (slug: string, name: string) => void;
}) {
  const { t, localize } = useI18n();
  const compsQuery = useCompetitions();
  const comps = (compsQuery.data?.competitions ?? []).filter((c) => c.kind === "league");

  return (
    <section className="mt-6">
      <SectionHeading
        title={t("leagues.title")}
        action={
          <Chip tone={followed.count >= 5 ? "gold" : "volt"}>
            {t("myTeams.picked", { count: followed.count, max: 5 })}
          </Chip>
        }
      />
      <p className="mb-2 text-[11px] text-ink-3">{t("leagues.subtitle", { max: 5 })}</p>

      {/* Full-width rows: league names truncate for real instead of wrapping
          around a single-letter monogram that duplicated the name's first
          letter ("PPremier League"). */}
      <ul className="space-y-2">
        {comps.map((comp) => {
          const following = followed.isFollowing(comp.slug);
          return (
            <li key={comp.slug}>
              <button
                type="button"
                onClick={() => onToggle(comp.slug, localize(comp.name))}
                className={cx(
                  "flex w-full items-center gap-3 rounded-card border p-3 text-start transition-colors duration-[var(--t-fast)]",
                  following ? "border-volt bg-elevated" : "border-line bg-surface hover:bg-elevated",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                  {localize(comp.name)}
                </span>
                {following ? (
                  <span className="flex flex-none items-center gap-1 text-[11px] font-bold text-volt">
                    <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    {t("leagues.following")}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
