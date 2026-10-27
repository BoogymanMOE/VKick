import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BottomSheet, SheetActions } from "../components/BottomSheet";

import { ChevronRightIcon, CloseIcon, PencilIcon } from "../components/icons";
import { TopBar, LanguageToggle } from "../components/TopBar";
import { useToast } from "../components/toastContext";
import { Avatar, Button, Card, Chip, ListRow, SectionHeading, Switch, TeamBadge } from "../components/ui";
import { useAuth } from "../hooks/authContext";
import { useFavorites } from "../hooks/useFavorites";
import { useNotificationPrefs, useReferral } from "../hooks/useApi";
import { LeaguePickerSheet } from "../components/panels/LeaguePickerSheet";
import { useI18n } from "../i18n/context";
import { PanelSkeleton } from "../components/Skeletons";
import { api, serverErrorKey } from "../lib/api";
import { APP_COMMIT, APP_VERSION, WHATS_NEW } from "../lib/appInfo";
import { PREDICTIONS_ENABLED, RATINGS_ENABLED } from "../lib/features";
import { LEGAL_ROUTES } from "../lib/legal";
import { useLocalState } from "../lib/useLocalState";
import { haptic, notifyHaptic } from "../lib/telegram";

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
  // Saved leagues are edited in place: the same picker sheet Matches uses.
  const [leaguesOpen, setLeaguesOpen] = useState(false);

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

  // The runtime badge is a dev indicator: stripped entirely from production
  // builds instead of just hidden, so no styling slip can resurrect it.
  const isDev = import.meta.env.DEV;

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

  const openPicker = () => {
    haptic("light");
    navigate("/onboarding");
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
            {viaTelegram ? (
              <span className="inline-flex items-center gap-1.5">
                {/* The small always-on dot: this account is linked to Telegram. */}
                <span aria-hidden="true" className="h-1.5 w-1.5 flex-none rounded-full bg-[var(--success,#22c55e)]" />
                {t("profile.connectedTg")}
              </span>
            ) : viaUsername && user?.username ? (
              `@${user.username}`
            ) : isDev ? (
              t("profile.browser")
            ) : null}
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
      </Card>

      <ClubSlots openPicker={openPicker} />

      {/* One grouped list — every row that has a real destination. Rows are
          inside a single rounded container separated by hairlines. */}
      <section className="mt-xl">
        <SectionHeading title={t("profile.settings")} />
        <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          <GroupRow
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
          />
          <GroupRow
            label={t("profile.myLeagues")}
            onClick={() => {
              haptic("light");
              setLeaguesOpen(true);
            }}
          />
          <GroupRow right={<LanguageToggle />} label={t("profile.language")} />
          <GroupRow
            label={t("profile.haptics")}
            hint={t("profile.hapticsHint")}
            right={<Switch checked={hapticsOn} label={t("profile.haptics")} onChange={setHapticsOn} />}
          />
          <GroupRow
            label={t("profile.resetLocal")}
            hint={t("profile.resetHint")}
            onClick={() => {
              haptic("light");
              setResetOpen(true);
            }}
          />
          <GroupRow label={t("legal.privacyTitle")} onClick={() => navigate(LEGAL_ROUTES.privacy)} />
          <GroupRow label={t("legal.termsTitle")} onClick={() => navigate(LEGAL_ROUTES.terms)} />
        </div>
        {/* Version line: the About prose card is gone; one muted line under
            the group suffices and doesn't compete with the rows. The commit
            rides along so a stale webview is visible at a glance, and the
            line is pinned LTR: in Persian the bidirectional algorithm would
            otherwise detach the dot from the sha and scramble the order. */}
        <p className="mt-sm px-1 text-xs text-ink-3" dir="ltr">
          {t("profile.version")} v{APP_VERSION} · {APP_COMMIT}
        </p>
      </section>

      <InviteFriends />

      {user?.isAdmin ? (
        <section className="mt-xl">
          <Button variant="ghost" className="w-full" onClick={() => navigate("/admin")}>
            {t("profile.admin")}
          </Button>
        </section>
      ) : null}

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

      <section className="mt-xl mb-2">
        <Button variant="ghost" className="w-full text-danger" onClick={signOut}>
          {t("profile.signOut")}
        </Button>
      </section>

      <LeaguePickerSheet open={leaguesOpen} onClose={() => setLeaguesOpen(false)} />

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
            <Button variant="ghost" className="flex-1" onClick={() => setDeleteOpen(false)} disabled={deleteBusy}>
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

/* ---------------------------------------------------------------- settings */

/** A plain row inside the grouped settings container (no own card border). */
function GroupRow({
  label,
  hint,
  onClick,
  right,
}: {
  label: string;
  hint?: string;
  onClick?: () => void;
  right?: React.ReactNode;})  {
  return (
    <div
      {...(onClick
        ? {
            onClick,
            role: "button" as const,
            tabIndex: 0,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            },
          }
        : {})}
      className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2.5 select-none active:bg-elevated"
    >
      <div className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-ink">{label}</span>
        {hint ? <span className="block text-xs text-ink-3">{hint}</span> : null}
      </div>
      {right ?? <ChevronRightIcon className="text-ink-3" />}
    </div>
  );
}

/* --------------------------------------------------------------- clubs */

/**
 * The five club slots, matching onboarding's 1 main club + 4 picks rule. The
 * main club on top with a star outline; the rest follow. Tapping any slot
 * (filled or not) opens the onboarding club picker. Empty: slots only — they
 * are their own prompt.
 */
function ClubSlots({ openPicker }: { openPicker: () => void }) {
  const { t, localize } = useI18n();
  const { teams, anchorId, loading } = useFavorites();
  // The anchored favorite is the main club (falls back to the first pick);
  // the rest fill the small slots in follow order.
  const main = teams.find((team) => team.id === anchorId) ?? teams[0] ?? null;
  const rest = teams.filter((club) => club.id !== main?.id);

  const open = openPicker;

  return (
    <section className="mt-xl">
      <SectionHeading title={t("profile.myClubs")} />
      {loading ? (
        <PanelSkeleton height={78} />
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-card border border-line bg-surface p-4">
          <Slot club={main} star onClick={open} localize={localize} />
          {Array.from({ length: Math.max(4, teams.length - 1) }).map((_, i) => (
            <Slot
              key={i}
              club={rest[i] ?? null}
              onClick={open}
              localize={localize}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function Slot({
  club,
  star,
  onClick,
  localize,
}: {
  club: ReturnType<typeof useFavorites>["teams"][number] | null;
  star?: boolean;
  onClick: () => void;
  localize: ReturnType<typeof useI18n>["localize"];
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={club ? localize(club.shortName) : undefined}
      className="group relative grid h-16 w-16 flex-none place-items-center rounded-full border border-dashed border-line bg-elevated text-ink-3 transition-colors duration-[var(--t-fast)] hover:border-volt hover:text-volt"
    >
      {star ? (
        <span aria-hidden="true" className="absolute -top-0.5 right-1.5 text-xs text-ink-3">
          ★
        </span>
      ) : null}
      {club ? (
        <span className="grid place-items-center">
          <TeamBadge team={club} size="sm" />
        </span>
      ) : (
        <span aria-hidden="true" className="text-lg font-bold">
          +
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------ invite */

/**
 * Invite friends as one card with one action that copies the link to the
 * clipboard. Kept above the tab bar's breathing room.
 */
function InviteFriends() {
  const { t } = useI18n();
  const { push } = useToast();
  const { referral, loading } = useReferral();

  const copyInvite = async () => {
    haptic("light");
    const code = referral?.code;
    if (!code) return;
    const url = `${window.location.origin}?startapp=${code}`;
    try {
      await navigator.clipboard.writeText(url);
      push({ text: t("referral.copied"), tone: "volt", icon: "✓" });
    } catch {
      /* clipboard unavailable (private mode) */
    }
  };

  return (
    <Card className="mt-xl p-3">
      <p className="text-sm font-bold text-ink">{t("referral.title")}</p>
      <Button className="mt-sm w-full" onClick={() => void copyInvite()} disabled={loading || !referral}>
        {t("referral.copyInvite")}
      </Button>
    </Card>
  );
}

/* ------------------------------------------------------------ what's new */

/**
 * User-facing release notes: a dismissible card at the bottom of Profile,
 * shown when the latest release hasn't been dismissed yet. Copy is rewritten
 * from CHANGELOG.md for players (see src/lib/appInfo.ts), never pasted.
 */
function WhatsNew() {
  const { t, lang } = useI18n();
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
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs font-bold text-ink-3 transition-colors duration-[var(--t-fast)] hover:text-ink-2"
          >
            <CloseIcon className="h-3 w-3" />
            {t("whatsNew.dismiss")}
          </button>
        </div>
        <ul className="mt-2 space-y-1.5">
          {(lang === "fa" ? latest.linesFa : latest.lines).map((line, i) => (
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
