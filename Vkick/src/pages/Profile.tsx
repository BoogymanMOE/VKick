import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BottomSheet, SheetActions } from "../components/BottomSheet";
import { TopBar } from "../components/TopBar";
import { CloseIcon, PencilIcon } from "../components/icons";
import { useToast } from "../components/Toast";
import { Avatar, Button, Card, Chip, ListRow, SectionHeading, Switch } from "../components/ui";
import { useAuth } from "../hooks/useAuth";
import { useNotificationPrefs } from "../hooks/useApi";
import { LANG_LABEL, type Lang } from "../i18n/strings";
import { useI18n } from "../i18n/I18nProvider";
import { serverErrorKey } from "../lib/api";
import { APP_VERSION, WHATS_NEW } from "../lib/appInfo";
import { useLocalState } from "../lib/useLocalState";
import { haptic, notifyHaptic } from "../lib/telegram";

export default function Profile() {
  const { t, lang, setLang } = useI18n();
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

      <Card className="mt-3 flex items-center gap-3 p-4">
        <Avatar name={displayName} tone="volt" size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-ink">{displayName}</p>
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

      <section className="mt-6">
        <SectionHeading title={t("profile.account")} />
        <div className="space-y-2">
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
              serverPrefs.goals || serverPrefs.deadline || serverPrefs.ratings
                ? t("profile.notificationsOn")
                : t("profile.notificationsOff")
            }
            onClick={() => {
              haptic("light");
              setNotificationsOpen(true);
            }}
            right={<span className="text-ink-3">›</span>}
          />
          {/* The "why did I get X" panel: every pick with the resolver's own
              line items, reachable from where users check their account. */}
          <ListRow
            label={t("predictions.title")}
            hint={t("predictions.subtitle")}
            onClick={() => {
              haptic("light");
              navigate("/predictions");
            }}
            right={<span className="text-ink-3">›</span>}
          />
        </div>
      </section>

      <section className="mt-6">
        <SectionHeading title={t("profile.language")} />
        <div className="flex gap-2">
          {(Object.keys(LANG_LABEL) as Lang[]).map((code) => (
            <Button
              key={code}
              variant={lang === code ? "primary" : "ghost"}
              className="flex-1"
              onClick={() => {
                haptic("light");
                setLang(code);
              }}
            >
              {LANG_LABEL[code]}
            </Button>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <SectionHeading title={t("profile.settings")} />
        <div className="space-y-2">
          <ListRow
            label={t("profile.haptics")}
            hint={t("profile.hapticsHint")}
            right={<Switch checked={hapticsOn} label={t("profile.haptics")} onChange={setHapticsOn} />}
          />
          <ListRow
            label={t("profile.resetLocal")}
            hint={t("profile.resetHint")}
            onClick={() => {
              haptic("medium");
              try {
                // Wipe local data but keep the auth keys: the device id (so the
                // same guest account is waiting when the user comes back) and
                // the signed-out flag (so this doesn't silently sign them in).
                const keep = new Set([
                  "verdikick.deviceId",
                  "verdikick.loggedOut",
                  "matchday.deviceId",
                  "matchday.loggedOut",
                ]);
                Object.keys(localStorage)
                  .filter(
                    (key) => (key.startsWith("verdikick.") || key.startsWith("matchday.")) && !keep.has(key),
                  )
                  .forEach((key) => localStorage.removeItem(key));
              } catch {
                /* private mode */
              }
              push({ text: t("profile.resetDone"), tone: "danger", icon: "⟲" });
            }}
            right={<span className="text-ink-3">›</span>}
          />
        </div>
      </section>

      <section className="mt-6">
        <SectionHeading title={t("profile.about")} />
        <Card className="space-y-2 p-3">
          <p className="text-sm text-ink-2">{t("profile.aboutBody")}</p>
          <div className="flex items-center justify-between border-t border-line pt-2 text-xs text-ink-3">
            <span>{t("profile.version")}</span>
            <span>
              v{APP_VERSION} · {viaTelegram ? "Telegram Mini App" : "Web"}
            </span>
          </div>
        </Card>
      </section>

      <WhatsNew />

      <section className="mt-6 mb-2">
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
        <div className="space-y-2">
          <ListRow
            label={t("profile.notifGoals")}
            hint={t("profile.notifGoalsHint")}
            right={
              <Switch
                checked={serverPrefs.goals}
                label={t("profile.notifGoals")}
                onChange={setPref("goals")}
              />
            }
          />
          <ListRow
            label={t("profile.notifDeadline")}
            hint={t("profile.notifDeadlineHint")}
            right={
              <Switch
                checked={serverPrefs.deadline}
                label={t("profile.notifDeadline")}
                onChange={setPref("deadline")}
              />
            }
          />
          <ListRow
            label={t("profile.notifRatings")}
            hint={t("profile.notifRatingsHint")}
            right={
              <Switch
                checked={serverPrefs.ratings}
                label={t("profile.notifRatings")}
                onChange={setPref("ratings")}
              />
            }
          />
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
    </>
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
    <section className="mt-6">
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
