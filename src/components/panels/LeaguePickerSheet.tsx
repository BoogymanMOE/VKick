import { useMemo, useState } from "react";
import { BottomSheet } from "../BottomSheet";
import { CompRowSkeleton } from "../Skeletons";
import { Chip, EmptyState, ErrorState, Segmented } from "../ui";
import { CheckIcon } from "../icons";
import { cx } from "../../lib/cx";
import { useCompetitions, useFollowedLeagues } from "../../hooks/useApi";
import { MAX_FOLLOWED_LEAGUES } from "../../hooks/useFavorites";
import { useI18n } from "../../i18n/context";
import { serverErrorKey, type ApiCompetition } from "../../lib/api";
import {
  leaguePickerSections,
  type LeagueKindFilter,
  type LeaguePickerSectionId,
} from "../../lib/leaguePicker";
import { haptic, selectionHaptic } from "../../lib/telegram";
import { useToast } from "../toastContext";
import type { StringKey } from "../../i18n/strings";

/** The section heading copy — the same grouping Browse uses. */
const SECTION_TITLE: Record<LeaguePickerSectionId, StringKey> = {
  league: "browse.leagues",
  cup: "browse.cups",
  tournament: "browse.tournaments",
};

/**
 * Favorite Leagues — the Matches feed's league picker.
 *
 * Two things it must get right beyond "a list of toggles":
 *  - it lists the whole `/api/competitions` catalog, cups and international
 *    tournaments included, because following a competition is how a user
 *    subscribes to its fixtures, tables and matchday alerts (see
 *    server/notifications.ts: `leagueFollowers`), not just the big five;
 *  - the cap answer is immediate and in the user's language — a full list
 *    toasts `leagues.errCap` instead of a silent no-op, and the server's own
 *    MAX_LEAGUES stays the rule that holds under a double tap.
 *
 * Writes go through `useFollowedLeagues`, whose invalidate refreshes the
 * Matches chip row behind the sheet, so the feed re-scopes as the sheet closes.
 */
export function LeaguePickerSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, localize } = useI18n();
  const { push } = useToast();
  const comps = useCompetitions();
  const followed = useFollowedLeagues();
  const [filter, setFilter] = useState<LeagueKindFilter>("all");

  const sections = useMemo(
    () => leaguePickerSections(comps.data?.competitions ?? [], filter, followed.slugs),
    [comps.data, filter, followed.slugs],
  );

  const full = followed.count >= MAX_FOLLOWED_LEAGUES;

  function toggle(comp: ApiCompetition) {
    const onError = (err: unknown) => {
      haptic("medium");
      push({ text: t(serverErrorKey(err) as StringKey), tone: "danger", icon: "✕" });
    };
    if (followed.isFollowing(comp.slug)) {
      selectionHaptic();
      followed.unfollow.mutate(comp.slug, { onError });
      return;
    }
    if (full) {
      // The cap is a bucket, not an error state: say which rule stopped it.
      haptic("medium");
      push({ text: t("leagues.errCap"), tone: "danger", icon: "✕" });
      return;
    }
    selectionHaptic();
    followed.follow.mutate(comp.slug, { onError });
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={t("leagues.title")}
      subtitle={t("leagues.subtitle")}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 pb-1">
          <Chip tone={full ? "gold" : "volt"}>
            {t("leagues.count", { count: followed.count, max: MAX_FOLLOWED_LEAGUES })}
          </Chip>
          <span className="min-w-0 flex-1 text-end text-[10px] leading-tight text-ink-3">
            {t(full ? "leagues.capHint" : "leagues.notifyHint", { max: MAX_FOLLOWED_LEAGUES })}
          </span>
        </div>
      }
    >
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: t("browse.all") },
          { value: "league", label: t("browse.leagues") },
          { value: "cup", label: t("browse.cups") },
        ]}
      />

      {comps.isLoading ? (
        <div className="mt-3">
          <CompRowSkeleton rows={6} />
        </div>
      ) : comps.isError ? (
        <div className="mt-3">
          <ErrorState title={t("leagues.error")} hint={t("error.hint")} onRetry={() => comps.refetch()} />
        </div>
      ) : sections.length === 0 ? (
        <div className="mt-3">
          <EmptyState title={t("leagues.empty")} hint={t("leagues.emptyHint")} />
        </div>
      ) : (
        // Keyed on the filter so the list crossfades when the tab changes
        // instead of swapping rows in place underneath the header.
        <div key={filter} className="fade-swap">
          {sections.map((section) => (
            <section key={section.id} className="mt-4">
              <h3 className="label mb-2 text-ink-3">{t(SECTION_TITLE[section.id])}</h3>
              <ul className="space-y-1.5">
                {section.rows.map((comp) => {
                  const on = followed.isFollowing(comp.slug);
                  const pending =
                    (followed.follow.isPending && followed.follow.variables === comp.slug) ||
                    (followed.unfollow.isPending && followed.unfollow.variables === comp.slug);
                  const name = localize(comp.name);
                  // A coming-soon competition has no synced data behind it, so
                  // following it would subscribe the user to fixtures that never
                  // arrive. Rendered — the scope is worth seeing — but inert,
                  // exactly like Browse's disabled rows.
                  const soon = Boolean(comp.comingSoon);
                  const Wrapper = soon ? "div" : "button";
                  return (
                    <li key={comp.slug}>
                      <Wrapper
                        {...(soon
                          ? {}
                          : {
                              type: "button" as const,
                              onClick: () => toggle(comp),
                              "aria-pressed": on,
                              "aria-label": t(on ? "leagues.unfollow" : "leagues.follow", {
                                league: name,
                              }),
                            })}
                        className={cx(
                          "flex min-h-12 w-full items-center gap-3 rounded-card border p-2.5 text-start transition-[color,background-color,transform] duration-[var(--t-fast)] active:scale-[0.98]",
                          soon
                            ? "border-dashed border-line bg-transparent opacity-70"
                            : on
                              ? "border-volt bg-elevated"
                              : "border-line bg-surface hover:bg-elevated",
                          pending && "opacity-60",
                        )}
                      >
                        {/* No monogram tile: a single letter beside the full
                            name reads as doubled text ("PPremier League"). */}
                        <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">{name}</span>
                        {soon ? (
                          <Chip tone="muted">{t("browse.soon")}</Chip>
                        ) : on ? (
                          <span className="flex flex-none items-center gap-1 text-[11px] font-bold text-volt">
                            <CheckIcon className="marker-pop h-3.5 w-3.5" aria-hidden="true" />
                            {t("leagues.following")}
                          </span>
                        ) : null}
                      </Wrapper>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}
