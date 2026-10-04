import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { useToast } from "../components/Toast";
import { Button, Chip, Num, Segmented, TeamBadge, cx } from "../components/ui";
import { ArrowIcon, CheckIcon, CloseIcon, PencilIcon, StarFilledIcon, TargetIcon } from "../components/icons";
import { useTeams, useCompetitions } from "../hooks/useApi";
import { MAX_FAVORITES, MAX_INTERNATIONALS, useFavorites, useFollowedLeagues } from "../hooks/useFavorites";
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
  const { teams, anchorId, count, clubCount, intlCount, isFavorite, toggle, setAnchor } = useFavorites();
  const followed = useFollowedLeagues();
  const [intro, setIntro] = useState(() => !introSeen());
  const [step, setStep] = useState(0);
  const [saved, setSaved] = useState(false);

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

  const anchorTeam = useMemo(() => allTeams.find((team) => team.id === anchorId), [allTeams, anchorId]);
  const anchorName = useMemo(
    () => (anchorTeam ? localize(anchorTeam.shortName) : ""),
    [anchorTeam, localize],
  );

  function pickClub(team: (typeof allTeams)[number]) {
    selectionHaptic();
    if (isFavorite(team.id)) return;
    // A changed pick un-saves the step: the Save button comes back so the
    // written confirmation never names a team the user just swapped out.
    setSaved(false);
    if (count === 0) {
      // First pick becomes the anchor automatically.
      toggle(team);
      setAnchor.mutate(team.id);
      return;
    }
    // The caps are per bucket — five clubs plus, separately, five national
    // teams — so a full club shelf says so without ever blocking the
    // international tab.
    const result = toggle(team);
    if (!result.ok) {
      haptic("medium");
      push({
        text: t(result.reason === "intlCap" ? "myTeams.errIntlCap" : "myTeams.errCap"),
        tone: "danger",
        icon: "✕",
      });
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

  /**
   * Explicit save on the favorite-club step: persists the gate flag so the
   * Matchday feed scopes to the saved club, and confirms the choice in copy —
   * the picker alone used to leave “did my pick stick?” unanswered.
   */
  function saveFavorite() {
    try {
      localStorage.setItem("verdikick.onboarded", "1");
    } catch {
      /* private mode */
    }
    notifyHaptic("success");
    setSaved(true);
  }

  /** Advance a step; leaving the favorite step persists the gate flag. */
  function advance() {
    haptic("light");
    if (step === 0) {
      try {
        localStorage.setItem("verdikick.onboarded", "1");
      } catch {
        /* private mode */
      }
    }
    setStep((s) => s + 1);
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
              "h-1.5 rounded-full transition-[width,background-color] duration-[var(--t-std)]",
              i === step ? "w-6 bg-volt" : i < step ? "w-1.5 bg-volt/50" : "w-1.5 bg-line",
            )}
          />
        ))}
      </div>

      {step === 0 ? (
        <section className="mt-5 rise-in">
          <h2 className="text-xl font-extrabold text-ink">{t("onboarding.favoriteTitle")}</h2>
          <p className="mt-1 text-sm text-ink-2">{t("onboarding.favoriteHint")}</p>

          {/* The pick so far, named and faced: survives tab switches, so the
              user never has to remember what they tapped two tabs ago. */}
          {anchorTeam ? (
            <div
              className="mt-3 flex items-center gap-2.5 rounded-card border border-gold bg-elevated px-3 py-2.5"
              role="status"
            >
              <TeamBadge team={anchorTeam} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-ink">{anchorName}</p>
                <p className="flex items-center gap-1 text-[11px] font-bold text-gold">
                  <StarFilledIcon className="h-3 w-3 flex-none" />
                  {t("onboarding.isFavorite")}
                </p>
              </div>
            </div>
          ) : null}

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

          {/* Picked clubs so far, removable: the count chip alone makes people
              back out to fix a mistaken pick. */}
          {count > 0 ? (
            <ul className="-mx-3 mt-3 flex gap-2 overflow-x-auto px-3 pb-1">
              {[...teams]
                .sort((a, b) => Number(b.id === anchorId) - Number(a.id === anchorId))
                .map((team) => (
                  <li key={team.id} className="relative flex-none">
                    <div className="flex w-[76px] flex-col items-center gap-1 rounded-card border border-line bg-surface p-2 text-center">
                      <TeamBadge team={team} size="sm" />
                      <span className="w-full truncate text-[10px] font-bold text-ink">
                        {localize(team.shortName)}
                      </span>
                    </div>
                    {team.id === anchorId ? (
                      <span
                        className="absolute -top-1 -start-1 grid h-5 w-5 place-items-center rounded-full border border-gold bg-elevated text-gold"
                        aria-label={t("onboarding.isFavorite")}
                      >
                        <StarFilledIcon className="h-2.5 w-2.5" />
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => pickClub(team)}
                      aria-label={t("myTeams.removed", { team: localize(team.shortName) })}
                      className="absolute -top-1 -end-1 grid h-11 w-11 place-items-center rounded-full"
                    >
                      <span
                        className="grid h-5 w-5 place-items-center rounded-full border border-line bg-elevated text-ink-2 transition-colors duration-[var(--t-fast)] hover:border-danger hover:text-danger"
                        aria-hidden="true"
                      >
                        <CloseIcon className="h-2.5 w-2.5" />
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          ) : null}

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

          {/* Two honest counters, one per shelf: clubs on the left, the
              optional national-team shelf on the right. */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <Chip tone={clubCount >= MAX_FAVORITES ? "gold" : "volt"}>
              {t("myTeams.picked", { count: clubCount, max: MAX_FAVORITES })}
            </Chip>
            {intlCount > 0 || clubCount >= MAX_FAVORITES ? (
              <Chip tone={intlCount >= MAX_INTERNATIONALS ? "gold" : "volt"}>
                {t("myTeams.pickedIntl", { count: intlCount, max: MAX_INTERNATIONALS })}
              </Chip>
            ) : null}
          </div>
          <p className="mt-2 text-center text-[11px] text-ink-3">{t("onboarding.intlHint")}</p>
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

      {/* Actions. The favorite step (the product's anchor) gets a real Save
          button with a written confirmation instead of a silent toggle; after
          saving, the same button becomes Continue so the flow stays one-tap. */}
      <div className="mt-6 space-y-2 pb-6">
        {step === 0 && count >= 1 ? (
          <>
            {saved ? (
              <p
                className="rise-in flex items-center justify-center gap-1.5 rounded-card border border-volt px-3 py-2.5 text-xs font-bold text-volt"
                role="status"
              >
                <CheckIcon className="h-4 w-4 flex-none" />
                {t("onboarding.favoriteSaved", { team: anchorName })}
              </p>
            ) : null}
            <Button className="w-full" onClick={saved ? advance : saveFavorite}>
              {t(saved ? "onboarding.next" : "common.save")}
            </Button>
          </>
        ) : null}
        {canAdvance && step > 0 && step < TOTAL_STEPS - 1 ? (
          <Button className="w-full" onClick={advance}>
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
 * The first-launch intro, now one screen instead of three slides. A first-timer
 * used to pay six screens (three intro slides, then three picker steps) before
 * seeing a fixture — on the one app whose whole promise is "open it because a
 * match is on". The three ideas still get explained, as a single scannable
 * list, with one "Get started" tap into the picker. Shown once ever (its flag is
 * separate from the picker's own gate).
 */
function Intro({ onDone }: { onDone: () => void }) {
  const { t } = useI18n();

  return (
    <div className="pad-safe-top flex min-h-[70vh] flex-col px-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => {
            haptic("light");
            onDone();
          }}
          className="min-h-11 rounded-full px-3 text-xs font-bold text-ink-3 transition-colors duration-[var(--t-fast)] hover:text-ink-2"
        >
          {t("intro.skip")}
        </button>
      </div>

      <div className="pitch-watermark flex flex-1 flex-col justify-center px-2 py-6">
        <span
          className="intro-glyph grid h-20 w-20 place-items-center rounded-card border border-volt/50 bg-elevated text-volt"
          aria-hidden="true"
        >
          <TargetIcon className="h-9 w-9" />
        </span>
        {/* The intro has no TopBar, so this brand line is the screen's only
            heading — h1, not h2, or the document opens at a level down. */}
        <h1 className="intro-in mt-5 text-2xl font-extrabold text-ink">{t("app.name")}</h1>

        <ul className="intro-in mt-5 space-y-4">
          {SLIDES.map(({ key, titleKey, bodyKey, Glyph }) => (
            <li key={key} className="flex items-start gap-3">
              <span
                className="grid h-9 w-9 flex-none place-items-center rounded-full border border-volt/50 bg-elevated text-volt"
                aria-hidden="true"
              >
                <Glyph className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-ink">{t(titleKey)}</span>
                <span className="block text-xs leading-relaxed text-ink-2">{t(bodyKey)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-4 space-y-2 pb-6">
        <Button
          className="w-full"
          onClick={() => {
            haptic("light");
            onDone();
          }}
        >
          {t("onboarding.next")}
        </Button>
        <button
          type="button"
          onClick={() => {
            haptic("light");
            onDone();
          }}
          className="min-h-11 w-full rounded-full text-xs font-bold text-ink-3 transition-colors hover:text-ink-2"
        >
          {t("intro.skip")}
        </button>
      </div>
    </div>
  );
}
