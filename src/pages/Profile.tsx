import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BottomSheet, SheetActions } from "../components/BottomSheet";
import { TopBar, LanguageToggle } from "../components/TopBar";
import { ChevronRightIcon, CloseIcon, PencilIcon, ShareIcon } from "../components/icons";
import { useToast } from "../components/toastContext";
import { Avatar, Button, Card, Chip, EmptyState, ListRow, SectionHeading, Switch, TeamBadge } from "../components/ui";
import { useAuth } from "../hooks/authContext";
import { useFavorites } from "../hooks/useFavorites";
import { useNotificationPrefs, useReferral } from "../hooks/useApi";
import { useI18n } from "../i18n/context";
import { PanelSkeleton } from "../components/Skeletons";
import { api, serverErrorKey } from "../lib/api";
import { APP_VERSION, WHATS_NEW } from "../lib/appInfo";
import { PREDICTIONS_ENABLED, RATINGS_ENABLED } from "../lib/features";
import { LEGAL_ROUTES } from "../lib/legal";
import { useLocalState } from "../lib/useLocalState";
import { haptic, notifyHaptic, shareToTelegram } from "../lib/telegram";

/**
 * Reject after `ms` so a request that never settles cannot pin the UI in a
 * busy state. The underlying fetch is left alone — it may still complete — but
 * the caller gets an error and can recover.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("REQUEST_TIMEOUT")), ms);
    }),
  ]);
}

export default function Profile() {
  const { t } = useI18n();
  const { push } = useToast();
  const { user, logout, updateDisplayName } = useAuth();
  const navigate = useNavigate();
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  // Rename display name: draft state for the sheet, error mirrors the form
  // pattern on the Login screen.
  const [nameOpen, setNameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameBusy, setNameBusy] = useState(false);

  // Delete account: a confirm sheet, an explicit destructive action, and the
  // busy/error state the form pattern uses everywhere else.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  /** Reset local data: a confirm sheet, no silent wipe. */
  const [resetOpen, setResetOpen] = useState(false);

  // Push preferences live on the SERVER (user_notification_prefs) — the bot
  // checks them before sending, so these toggles actually gate sends. Only
  // the haptics switch stays local (it's a device-side concern).
  const { prefs, set } = useNotificationPrefs();
  const serverPrefs = prefs ?? { goals: true, deadline: true, ratings: true };
  const [hapticsOn, setHapticsOn] = useLocalState<boolean>("matchday.haptics", true);

  const setPref = (key: "goals" | "deadline" | "ratings") => (next: boolean) => {
    set.mutate({ [key]: next });
  };

  // Identity comes from the server session (username login or Telegram link).
  const displayName = user?.displayName || t("profile.guest");
  const viaTelegram = user?.authMode === "telegram";
  const viaUsername = user?.authMode === "session" && user.username !== null;

  const signOut = async () => {
    haptic("medium");
    await logout();
    // useAuth's guard takes over and lands the user on /login.
  };

  /**
   * Irreversible: the server removes every row the user owns, then we clear
   * the local credential. logout()'s own request 401s (its session row is
   * already gone) and is swallowed — clearing local state is what matters.
   *
   * The request is bounded: a stalled DELETE (flaky network, a backend busy
   * cascading the rows) must not leave the confirm sheet spinning forever with
   * both of its buttons disabled and no way out.
   */
  const confirmDelete = async () => {
    if (deleteBusy) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await withTimeout(api.deleteAccount(), 20_000);
      notifyHaptic("success");
      await logout();
    } catch (err) {
      notifyHaptic("error");
      setDeleteError(t(serverErrorKey(err) as never));
      setDeleteBusy(false);
    }
  };

  const confirmReset = () => {
    haptic("medium");
    try {
      // Keep auth + device identity: the device id (so the same guest account is
      // waiting when the user comes back), the session token (so the user stays
      // signed in), and the signed-out flag (so this doesn't silently sign them in).
      const keep = new Set([
        "verdikick.deviceId",
        "verdikick.loggedOut",
        "matchday.deviceId",
        "matchday.loggedOut",
        "matchday.session",
      ]);
      Object.keys(localStorage)
        .filter((key) => (key.startsWith("verdikick.") || key.startsWith("matchday.")) && !keep.has(key))
        .forEach((key) => localStorage.removeItem(key));
    } catch {
      /* private mode */
    }
    setResetOpen(false);
    push({ text: t("profile.resetDone"), tone: "danger", icon: "⟲" });
  };

  const openNameEditor = () => {
    haptic("light");
    setNameDraft(displayName);
    setNameError(null);
    setNameOpen(true);
  };

  const saveName = async () => {
    if (nameBusy) return;
    const next = nameDraft.replace(/\s+/g, " ").trim();
    if (!next) {
      notifyHaptic("error");
      setNameError(t("profile.nameEmpty"));
      return;
    }
    if (next === displayName) {
      setNameOpen(false);
      return;
    }
    setNameBusy(true);
    try {
      await updateDisplayName(next);
      haptic("medium");
      push({ text: t("toast.nameSaved"), tone: "volt", icon: "✓" });
      setNameOpen(false);
    } catch (err) {
      notifyHaptic("error");
      setNameError(t(serverErrorKey(err) as never));
    } finally {
      setNameBusy(false);
    }
  };

  return (
    <>
      <TopBar title={t("profile.title")} />

      <Card className="mt-md flex items-center gap-3 p-4">
        <Avatar name={displayName} tone="volt" size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-md font-bold text-ink">{displayName}</p>
          <p className="truncate text-xs text-ink-2">
            {viaUsername && user?.username
              ? `@${user.username}`
              : viaTelegram
                ? t("profile.telegram")
                : t("profile.browser")}
          </p>
        </div>
        <button
          type="button"
          onClick={openNameEditor}
          aria-label={t("profile.editName")}
          title={t("profile.editName")}
          className="group relative grid h-11 w-11 flex-none place-items-center rounded-full text-ink-2 transition-colors duration-[var(--t-fast)] hover:text-volt"
        >
          {/* 36px visual ring on an 44px hit area: the border stays a hairline,
              the target meets the touch floor. */}
          <span
            aria-hidden="true"
            className="absolute inset-[3px] rounded-full border border-line transition-colors duration-[var(--t-fast)] group-hover:border-volt"
          />
          <PencilIcon />
        </button>
        <Chip tone={viaTelegram ? "pitch" : "volt"}>
          {viaTelegram ? t("profile.env") : t("profile.accountChip")}
        </Chip>
      </Card>

      <section className="mt-xl">
        <SectionHeading title={t("profile.account")} />
        <div className="space-y-sm">
          <FavoriteTeamsStrip />
          <ListRow
            label={t("profile.telegram")}
            hint={viaTelegram ? t("profile.signedIn") : t("profile.linkTelegram")}
            right={
              viaTelegram ? (
                <Chip tone="pitch">{t("profile.linked")}</Chip>
              ) : (
                <Chip tone="muted">{t("profile.notLinked")}</Chip>
              )
            }
          />
          <ListRow
            label={t("profile.notifications")}
            hint={
              serverPrefs.goals ||
              (RATINGS_ENABLED && serverPrefs.ratings) ||
              (PREDICTIONS_ENABLED && serverPrefs.deadline)
                ? t("profile.notificationsOn")
                : t("profile.notificationsOff")
            }
            onClick={() => {
              haptic("light");
              setNotificationsOpen(true);
            }}
            right={<ChevronRightIcon className="text-ink-3" />}
          />
          {/* My Teams is gone; the saved favorite team & leagues are edited
              in the onboarding picker, reached from here. */}
          <ListRow
            label={t("onboarding.favoriteTitle")}
            hint={t("onboarding.editPicksHint")}
            onClick={() => {
              haptic("light");
              navigate("/onboarding");
            }}
            right={<ChevronRightIcon className="text-ink-3" />}
          />
          {/* The "why did I get X" panel: every pick with the resolver's own
              line items, reachable from where users check their account. */}

        </div>
      </section>

      <ReferralSection />

      <section className="mt-xl">
        <SectionHeading title={t("profile.settings")} />
        <div className="space-y-sm">
          <ListRow label={t("profile.language")} right={<LanguageToggle />} />
          <ListRow
            label={t("profile.haptics")}
            hint={t("profile.hapticsHint")}
            onToggle={() => setHapticsOn(!hapticsOn)}
            right={<Switch checked={hapticsOn} label={t("profile.haptics")} onChange={setHapticsOn} />}
          />
          <ListRow
            label={t("profile.resetLocal")}
            hint={t("profile.resetHint")}
            onClick={() => {
              haptic("light");
              setResetOpen(true);
            }}
            right={<ChevronRightIcon className="text-ink-3" />}
          />
        </div>
      </section>

      <section className="mt-xl">
        <SectionHeading title={t("profile.about")} />
        <Card className="space-y-sm p-3">
          <p className="text-sm text-ink-2">{t("profile.aboutBody")}</p>
          <div className="flex items-center justify-between border-t border-line pt-2 text-xs text-ink-3">
            <span>{t("profile.version")}</span>
            <span>
              v{APP_VERSION} · {t(viaTelegram ? "profile.platformTelegram" : "profile.platformWeb")}
            </span>
          </div>
        </Card>
      </section>

      <section className="mt-xl">
        <SectionHeading title={t("profile.legal")} />
        <div className="space-y-sm">
          <ListRow
            label={t("legal.privacyTitle")}
            onClick={() => {
              haptic("light");
              navigate(LEGAL_ROUTES.privacy);
            }}
            right={<ChevronRightIcon className="text-ink-3" />}
          />
          <ListRow
            label={t("legal.termsTitle")}
            onClick={() => {
              haptic("light");
              navigate(LEGAL_ROUTES.terms);
            }}
            right={<ChevronRightIcon className="text-ink-3" />}
          />
        </div>
      </section>

      <WhatsNew />

      <section className="mt-xl">
        <SectionHeading title={t("profile.dangerZone")} />
        {/* The one destructive row on the page: the label carries the live
            (coral) colour so the stakes are visible without reading the hint. */}
        <ListRow
          danger
          label={t("profile.deleteAccount")}
          hint={t("profile.deleteHint")}
          onClick={() => {
            haptic("medium");
            setDeleteError(null);
            setDeleteOpen(true);
          }}
          right={<ChevronRightIcon className="text-danger" />}
        />
      </section>

      {user?.isAdmin ? (
        <section className="mt-xl">
          <Button variant="ghost" className="w-full" onClick={() => navigate("/admin")}>
            Admin Dashboard
          </Button>
        </section>
      ) : null}

      <section className="mt-xl mb-2">
        <Button variant="ghost" className="w-full text-danger" onClick={signOut}>
          {t("profile.signOut")}
        </Button>
      </section>

      <BottomSheet
        open={notificationsOpen}
        onClose={() => setNotificationsOpen(false)}
        title={t("profile.notifications")}
        subtitle={t("profile.notificationsSub")}
        footer={
          <Button className="w-full" onClick={() => setNotificationsOpen(false)}>
            {t("common.done")}
          </Button>
        }
      >
        <div className="space-y-sm">
          <ListRow
            label={t("profile.notifGoals")}
            hint={t("profile.notifGoalsHint")}
            onToggle={() => setPref("goals")(!serverPrefs.goals)}
            right={
              <Switch
                checked={serverPrefs.goals}
                label={t("profile.notifGoals")}
                onChange={setPref("goals")}
              />
            }
          />
          {PREDICTIONS_ENABLED ? (
            <ListRow
              label={t("profile.notifDeadline")}
              hint={t("profile.notifDeadlineHint")}
              onToggle={() => setPref("deadline")(!serverPrefs.deadline)}
              right={
                <Switch
                  checked={serverPrefs.deadline}
                  label={t("profile.notifDeadline")}
                  onChange={setPref("deadline")}
                />
              }
            />
          ) : null}
          {/* The rating-window push is gated off, so its switch is too —
              leaving it would promise a notification nothing can send. */}
          {RATINGS_ENABLED ? (
            <ListRow
              label={t("profile.notifRatings")}
              hint={t("profile.notifRatingsHint")}
              onToggle={() => setPref("ratings")(!serverPrefs.ratings)}
              right={
                <Switch
                  checked={serverPrefs.ratings}
                  label={t("profile.notifRatings")}
                  onChange={setPref("ratings")}
                />
              }
            />
          ) : null}
        </div>
      </BottomSheet>

      <BottomSheet
        open={nameOpen}
        onClose={() => setNameOpen(false)}
        title={t("profile.editName")}
        subtitle={t("auth.displayNamePlaceholder")}
        footer={
          <SheetActions>
            <Button variant="ghost" className="flex-1" onClick={() => setNameOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button className="flex-1" onClick={() => void saveName()} disabled={nameBusy}>
              {nameBusy ? t("common.loading") : t("common.save")}
            </Button>
          </SheetActions>
        }
      >
        <label className="block space-y-1">
          <span className="label text-ink-2">{t("auth.displayName")}</span>
          <input
            className="min-h-12 w-full rounded-card border border-line bg-surface px-3.5 text-sm text-ink placeholder:text-ink-3 focus:border-volt focus:outline-none focus:ring-4 focus:ring-[color-mix(in_srgb,var(--volt)_16%,transparent)]"
            value={nameDraft}
            onChange={(e) => {
              setNameDraft(e.target.value);
              setNameError(null);
            }}
            maxLength={40}
            autoComplete="nickname"
            dir="auto"
            enterKeyHint="done"
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName();
            }}
          />
        </label>
        {nameError ? (
          <p
            className="mt-2 rounded-card border border-danger px-3 py-2 text-xs font-bold text-danger"
            role="alert"
          >
            {nameError}
          </p>
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={deleteOpen}
        onClose={() => {
          if (!deleteBusy) setDeleteOpen(false);
        }}
        title={t("profile.deleteConfirmTitle")}
        subtitle={t("profile.deleteHint")}
        footer={
          <SheetActions>
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteBusy}
            >
              {t("common.cancel")}
            </Button>
            <Button
              className="flex-1 border border-danger text-danger"
              variant="ghost"
              onClick={() => void confirmDelete()}
              disabled={deleteBusy}
            >
              {deleteBusy ? t("profile.deleting") : t("profile.deleteConfirm")}
            </Button>
          </SheetActions>
        }
      >
        <p className="text-sm leading-relaxed text-ink-2">{t("profile.deleteConfirmBody")}</p>
        {deleteError ? (
          <p
            className="mt-md rounded-card border border-danger px-3 py-2 text-xs font-bold text-danger"
            role="alert"
          >
            {deleteError}
          </p>
        ) : null}
      </BottomSheet>

      <BottomSheet
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title={t("profile.resetLocal")}
        subtitle={t("profile.resetHint")}
        footer={
          <SheetActions>
            <Button variant="ghost" className="flex-1" onClick={() => setResetOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              className="flex-1 border border-danger text-danger"
              variant="ghost"
              onClick={confirmReset}
            >
              {t("profile.resetConfirm")}
            </Button>
          </SheetActions>
        }
      >
        <p className="text-sm leading-relaxed text-ink-2">{t("profile.resetHint")}</p>
      </BottomSheet>
    </>
  );
}

/* --------------------------------------------------------- favorite teams */

/**
 * The clubs the user follows, as a scrollable shelf of crest tiles. Profile
 * used to reach favorites only through the onboarding picker's edit link; the
 * shelf shows what is actually followed (and is the fastest way back to a club
 * page) without leaving the hub. Crest + short name only — this is a shortcut,
 * not the manager.
 *
 * Empty renders nothing: a first-run user with no picks gets the edit row
 * below, not an empty rail.
 */
function FavoriteTeamsStrip() {
  const { t, localize } = useI18n();
  const { teams, loading } = useFavorites();
  // First-run honest state: an empty rail with nothing at all read as a
  // broken component — say that no clubs are picked and where to pick them.
  // The strip reserves its own footprint while the favorites query resolves —
  // silently returning null made the whole Account section jump when the
  // shelf appeared (and read as a missing component on a slow connection).
  if (loading) return <PanelSkeleton height={78} />;
  if (teams.length === 0) {
    return (
      <EmptyState
        icon="⭐"
        title={t("profile.noClubs")}
        hint={t("profile.noClubsHint")}
      />
    );
  }

  return (
    <ul className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
      {teams.map((team) => (
        <li key={team.id} className="flex-none">
          <Link
            to={`/team/${team.id}`}
            onClick={() => haptic("light")}
            className="flex w-[76px] flex-col items-center gap-1 rounded-card border border-line bg-surface p-2 text-center transition-[color,background-color,transform] duration-[var(--t-fast)] hover:bg-elevated active:scale-[0.98]"
          >
            <TeamBadge team={team} size="sm" />
            <span className="w-full truncate text-xs font-bold text-ink">{localize(team.shortName)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------ referrals */

/**
 * Invite friends: the share code (copied to clipboard), the honest paid/cap
 * count, and — until the viewer has redeemed someone's code — the redeem
 * form. The server owns every rule (one code per user, one redemption per
 * account, capped rewards); this card only states what the state is.
 */
function ReferralSection() {
  const { t } = useI18n();
  const { push } = useToast();
  const { referral, loading, redeem, redeeming } = useReferral();
  const [codeDraft, setCodeDraft] = useState("");

  const copy = async () => {
    haptic("light");
    try {
      await navigator.clipboard.writeText(referral?.code ?? "");
      push({ text: t("referral.copied"), tone: "volt", icon: "✓" });
    } catch {
      /* clipboard unavailable (private mode) — the code is visible to copy by hand */
    }
  };

  const share = () => {
    haptic("light");
    const code = referral?.code;
    if (!code) return;
    const url = `${window.location.origin}?startapp=${code}`;
    const ok = shareToTelegram(url, t("referral.shareText"));
    if (!ok) {
      void copy();
    }
  };

  const submit = () => {
    const code = codeDraft.trim();
    if (!code || redeeming) return;
    redeem.mutate(code, {
      onSettled: () => setCodeDraft(""),
    });
  };

  return (
    <section className="mt-xl">
      <SectionHeading title={t("referral.title")} />
      <Card className="space-y-3 p-3">
        <p className="text-xs text-ink-2">{t("referral.hint")}</p>
        <div className="flex items-center gap-2">
          {/* Codes are Latin and typed by hand: always LTR, letterspaced so
              the 8 characters stay readable at a glance. */}
          <code
            dir="ltr"
            className="min-h-11 flex-1 rounded-card border border-line bg-elevated px-3 py-2.5 text-center text-sm font-black tracking-[0.3em] text-volt"
          >
            {loading || !referral ? "· · · · · · · ·" : referral.code}
          </code>
          <Button variant="ghost" onClick={() => void copy()} disabled={!referral}>
            {t("referral.copy")}
          </Button>
          <Button variant="ghost" onClick={share} disabled={!referral}>
            <ShareIcon className="h-4 w-4" />
            {t("referral.share")}
          </Button>
        </div>
        {referral ? (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-line pt-2 text-xs text-ink-3">
            <span>{t("referral.statInvited", { invited: referral.invited })}</span>
            <span>
              {t("referral.statPaid", { rewarded: referral.rewarded, max: referral.maxPaidInvites })}
            </span>
          </div>
        ) : null}
        {referral && !referral.youRedeemed ? (
          <div className="flex gap-2 border-t border-line pt-3">
            <input
              dir="ltr"
              className="min-h-11 min-w-0 flex-1 rounded-card border border-line bg-surface px-3 text-sm font-bold uppercase tracking-widest text-ink placeholder:font-normal placeholder:tracking-normal placeholder:text-ink-3 focus:border-volt focus:outline-none"
              placeholder={t("referral.redeemPlaceholder")}
              value={codeDraft}
              onChange={(e) => setCodeDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
              maxLength={12}
              autoComplete="off"
              autoCapitalize="characters"
              aria-label={t("referral.redeemPlaceholder")}
            />
            <Button onClick={submit} disabled={redeeming || !codeDraft.trim()}>
              {redeeming ? t("common.loading") : t("referral.redeem")}
            </Button>
          </div>
        ) : null}
      </Card>
    </section>
  );
}

/* ------------------------------------------------------------ what's new */

/**
 * User-facing release notes: a dismissible card at the bottom of Profile,
 * shown when the latest release hasn't been dismissed yet. Copy is rewritten
 * from CHANGELOG.md for players (see src/lib/appInfo.ts), never pasted.
 */
function WhatsNew() {
  const { t } = useI18n();
  const [seenRelease, setSeenRelease] = useLocalState<string>("verdikick.whatsNewSeen", "");
  const latest = WHATS_NEW[0];
  if (latest.version === seenRelease) return null;

  return (
    <section className="mt-xl">
      <SectionHeading title={t("whatsNew.title")} />
      <Card className="relative p-3">
        <div className="flex items-center justify-between">
          <Chip tone="volt">
            v{latest.version} · {latest.date}
          </Chip>
          <button
            type="button"
            onClick={() => {
              haptic("light");
              setSeenRelease(latest.version);
            }}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 text-xs font-bold text-ink-3 transition-colors duration-[var(--t-fast)] hover:text-ink-2"
          >
            <CloseIcon className="h-3 w-3" />
            {t("whatsNew.dismiss")}
          </button>
        </div>
        <ul className="mt-2 space-y-1.5">
          {latest.lines.map((line, i) => (
            <li key={i} className="flex gap-2 text-xs text-ink-2">
              <span className="flex-none text-volt" aria-hidden="true">
                •
              </span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
