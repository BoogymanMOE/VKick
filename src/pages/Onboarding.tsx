import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { useToast } from "../components/Toast";
import { Button, Chip, Num, Segmented, TeamBadge, cx } from "../components/ui";
import { ArrowIcon, CheckIcon, PencilIcon, StarFilledIcon, TargetIcon } from "../components/icons";
import { useTeams, useCompetitions } from "../hooks/useApi";
import { MAX_FAVORITES, useFavorites, useFollowedLeagues } from "../hooks/useFavorites";
import { useI18n } from "../i18n/I18nProvider";
import type { StringKey } from "../i18n/strings";
import { serverErrorKey } from "../lib/api";
import { haptic, selectionHaptic, notifyHaptic } from "../lib/telegram";
import { buildPickerGroups, teamsInGroup } from "../lib/pickerGroups";

const TOTAL_STEPS = 3;

/** localStorage flag for the animated intro (separate from the picker gate). */
const INTRO_KEY = "verdikick.introSeen";

function introSeen() {
  try {
    return localStorage.getItem(INTRO_KEY) === "1";
  } catch {
    return true; // private mode: never show the intro rather than loop on it
  }
}

/** The three ideas, in the order the product teaches them. */
const SLIDES = [
  { key: "follow", titleKey: "intro.follow.title", bodyKey: "intro.follow.body", Glyph: StarFilledIcon },
  { key: "predict", titleKey: "intro.predict.title", bodyKey: "intro.predict.body", Glyph: TargetIcon },
  { key: "rate", titleKey: "intro.rate.title", bodyKey: "intro.rate.body", Glyph: PencilIcon },
] as const;

/**
 * First-run onboarding in the concept's order:
 *   1. pick the favorite club (the anchor)
 *   2. pick up to four more clubs
 *   3. follow up to five leagues
 * Each step is skippable except the first — the anchor club is the product.
 */
export default function Onboarding() {
  const { t, localize } = useI18n();
  const { push } = useToast();
  const navigate = useNavigate();
  const { anchorId, count, isFavorite, toggle, setAnchor } = useFavorites();
  const followed = useFollowedLeagues();
  const [intro, setIntro] = useState(() => !introSeen());
  const [step, setStep] = useState(0);

  const teamsQuery = useTeams();
  // Stable identity: `groupTeams` and the picker memos below depend on it.
  const allTeams = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);
  const [group, setGroup] = useState<string>("PL");
  // The tabs reach the cup-only clubs and national teams too, not just the
  // big five — an onboarding flow that can only pick big-five clubs would
  // silently make everything else in the catalog unfollowable.
  const groupTeams = useMemo(() => teamsInGroup(allTeams, group), [allTeams, group]);

  const compsQuery = useCompetitions();
  const leagueComps = (compsQuery.data?.competitions ?? []).filter((c) => c.kind === "league");

  // Tabs come from the catalog: the big five, every other league, then the
  // catch-alls — same list Onboarding's league step uses for following.
  const pickerGroups = useMemo(
    () => buildPickerGroups(compsQuery.data?.competitions ?? [], (key) => t(key), localize),
    [compsQuery.data, t, localize],
  );

  function pickClub(team: (typeof allTeams)[number]) {
    selectionHaptic();
    if (isFavorite(team.id)) return;
    if (count === 0) {
      // First pick becomes the anchor automatically.
      toggle(team);
      setAnchor.mutate(team.id);
    } else {
      toggle(team);
    }
  }

  function pickLeague(slug: string) {
    const onError = (err: unknown) => {
      haptic("medium");
      push({ text: t(serverErrorKey(err) as StringKey), tone: "danger", icon: "✕" });
    };
    selectionHaptic();
    if (followed.isFollowing(slug)) {
      followed.unfollow.mutate(slug, { onError });
    } else if (followed.count < 5) {
      followed.follow.mutate(slug, { onError });
    } else {
      haptic("medium");
    }
  }

  function finish() {
    try {
      localStorage.setItem("verdikick.onboarded", "1");
    } catch {
      /* private mode */
    }
    notifyHaptic("success");
    navigate("/matches", { replace: true });
  }

  function dismissIntro() {
    try {
      localStorage.setItem(INTRO_KEY, "1");
    } catch {
      /* private mode */
    }
    setIntro(false);
  }

  const canAdvance = (step === 0 && count >= 1) || step === 1 || step === 2;

  if (intro) return <Intro onDone={dismissIntro} />;

  return (
    <>
      <TopBar
        title={t("onboarding.title")}
        subtitle={t("onboarding.step", { step: step + 1, total: TOTAL_STEPS })}
      />

      {/* Step dots */}
      <div className="mt-3 flex justify-center gap-1.5" aria-hidden="true">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <span
            key={i}
            className={cx(
              "h-1.5 rounded-full transition-all duration-[var(--t-std)]",
              i === step ? "w-6 bg-volt" : i < step ? "w-1.5 bg-volt/50" : "w-1.5 bg-line",
            )}
          />
        ))}
      </div>

      {step === 0 ? (
        <section className="mt-5 rise-in">
          <h2 className="text-xl font-extrabold text-ink">{t("onboarding.favoriteTitle")}</h2>
          <p className="mt-1 text-sm text-ink-2">{t("onboarding.favoriteHint")}</p>

          <div className="mt-3">
            <Segmented value={group} onChange={setGroup} options={pickerGroups} />
          </div>

          <ul className="mt-3 grid grid-cols-2 gap-2">
            {groupTeams.map((team) => {
              const pickedHere = isFavorite(team.id);
              const isAnchor = team.id === anchorId;
              return (
                <li key={team.id}>
                  <button
                    type="button"
                    onClick={() => pickClub(team)}
                    className={cx(
                      "flex w-full items-center gap-2 rounded-card border p-2.5 text-start transition-colors duration-[var(--t-fast)]",
                      pickedHere
                        ? isAnchor
                          ? "border-gold bg-elevated"
                          : "border-volt bg-elevated"
                        : "border-line bg-surface hover:bg-elevated",
                    )}
                  >
                    <TeamBadge team={team} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                      {localize(team.shortName)}
                    </span>
                    {isAnchor ? (
                      <StarFilledIcon className="h-4 w-4 flex-none text-gold" />
                    ) : pickedHere ? (
                      <CheckIcon className="h-4 w-4 flex-none text-volt" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="mt-5 rise-in">
          <h2 className="text-xl font-extrabold text-ink">{t("onboarding.clubsTitle")}</h2>
          <p className="mt-1 text-sm text-ink-2">{t("onboarding.clubsHint")}</p>

          <div className="mt-3">
            <Segmented value={group} onChange={setGroup} options={pickerGroups} />
          </div>

          <ul className="mt-3 grid grid-cols-2 gap-2">
            {groupTeams.map((team) => {
              const pickedHere = isFavorite(team.id);
              return (
                <li key={team.id}>
                  <button
                    type="button"
                    onClick={() => pickClub(team)}
                    className={cx(
                      "flex w-full items-center gap-2 rounded-card border p-2.5 text-start transition-colors duration-[var(--t-fast)]",
                      pickedHere ? "border-volt bg-elevated" : "border-line bg-surface hover:bg-elevated",
                    )}
                  >
                    <TeamBadge team={team} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                      {localize(team.shortName)}
                    </span>
                    {pickedHere ? (
                      <CheckIcon className="h-4 w-4 flex-none text-volt" aria-hidden="true" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex justify-center">
            <Chip tone={count >= MAX_FAVORITES ? "gold" : "volt"}>
              {t("myTeams.picked", { count, max: MAX_FAVORITES })}
            </Chip>
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="mt-5 rise-in">
          <h2 className="text-xl font-extrabold text-ink">{t("onboarding.leaguesTitle")}</h2>
          <p className="mt-1 text-sm text-ink-2">{t("onboarding.leaguesHint")}</p>

          <ul className="mt-3 space-y-2">
            {leagueComps.map((comp) => {
              const following = followed.isFollowing(comp.slug);
              return (
                <li key={comp.slug}>
                  <button
                    type="button"
                    onClick={() => pickLeague(comp.slug)}
                    className={cx(
                      "flex w-full items-center gap-3 rounded-card border p-3 text-start transition-colors duration-[var(--t-fast)]",
                      following ? "border-volt bg-elevated" : "border-line bg-surface hover:bg-elevated",
                    )}
                  >
                    {/* No monogram tile: a single letter next to the full name
                        reads as doubled text ("PPremier League"). */}
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                      {localize(comp.name)}
                    </span>
                    {following ? <Chip tone="volt">{t("leagues.following")}</Chip> : null}
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex justify-center">
            <Chip tone={followed.count >= 5 ? "gold" : "volt"}>
              {t("myTeams.picked", { count: followed.count, max: 5 })}
            </Chip>
          </div>
        </section>
      ) : null}

      {/* Actions */}
      <div className="mt-6 space-y-2 pb-6">
        {canAdvance && step < TOTAL_STEPS - 1 ? (
          <Button
            className="w-full"
            onClick={() => {
              haptic("light");
              setStep((s) => s + 1);
            }}
          >
            {t("onboarding.next")}
          </Button>
        ) : null}
        {step === TOTAL_STEPS - 1 ? (
          <Button className="w-full" onClick={finish}>
            {t("onboarding.done")}
          </Button>
        ) : null}
        {step === 0 && count === 0 ? (
          <button
            type="button"
            onClick={finish}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full text-xs font-bold text-ink-3 transition-colors hover:text-ink-2"
          >
            {t("onboarding.skip")}
          </button>
        ) : null}
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-full text-xs font-bold text-ink-3 transition-colors hover:text-ink-2"
          >
            <ArrowIcon className="h-4 w-4" />
            {t("common.back")}
          </button>
        ) : null}
      </div>

      <Num className="sr-only">{step}</Num>
    </>
  );
}

/* ------------------------------------------------------------ intro */

/**
 * The animated first-launch intro: three light slides over the core ideas,
 * skippable with one tap, shown before the club picker (once ever — its flag
 * is separate from the picker's own gate).
 */
function Intro({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();
  const total = SLIDES.length;
  const [slide, setSlide] = useState(0);
  const last = slide === total - 1;
  const current = SLIDES[slide];

  const next = () => {
    haptic("light");
    if (last) onDone();
    else setSlide((s) => s + 1);
  };

  return (
    <div className="pad-safe-top flex min-h-[70vh] flex-col px-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onDone}
          className="min-h-11 rounded-full px-3 text-xs font-bold text-ink-3 transition-colors duration-[var(--t-fast)] hover:text-ink-2"
        >
          {t("intro.skip")}
        </button>
      </div>

      <div className="pitch-watermark flex flex-1 flex-col items-center justify-center px-2 text-center">
        <span
          key={current.key}
          className="intro-glyph grid h-20 w-20 place-items-center rounded-card border border-volt/50 bg-elevated text-volt"
          aria-hidden="true"
        >
          <current.Glyph className="h-9 w-9" />
        </span>
        <h2 key={`${current.key}-t`} className="intro-in mt-5 text-xl font-extrabold text-ink">
          {t(current.titleKey)}
        </h2>
        <p key={`${current.key}-b`} className="intro-in mt-2 max-w-xs text-sm leading-relaxed text-ink-2">
          {t(current.bodyKey)}
        </p>
      </div>

      {/* Dots */}
      <div className="flex justify-center gap-1.5" aria-hidden="true">
        {SLIDES.map((s, i) => (
          <span
            key={s.key}
            className={cx(
              "h-1.5 rounded-full transition-all duration-[var(--t-std)]",
              i === slide ? "w-6 bg-volt" : "w-1.5 bg-line",
            )}
          />
        ))}
      </div>
      <p className="sr-only">{t("intro.dots", { step: slide + 1, total })}</p>

      <div className="mt-4 space-y-2 pb-6">
        <Button className="w-full" onClick={next}>
          {t("onboarding.next")}
        </Button>
        {!last ? (
          <button
            type="button"
            onClick={onDone}
            className="w-full rounded-full py-2 text-xs font-bold text-ink-3 transition-colors hover:text-ink-2"
          >
            {t("intro.skip")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
