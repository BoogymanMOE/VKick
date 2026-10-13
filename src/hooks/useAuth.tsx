import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { AuthContext, type AuthContextValue, type AuthUser, useAuth } from "./authContext";
import { api, type ApiRequestError } from "../lib/api";
import { isTelegram, waitForTelegram } from "../lib/telegram";
import {
  clearSession,
  currentAuthToken,
  getDeviceId,
  getSessionToken,
  hasExplicitDevUser,
  isLoggedOut,
  isRemembered,
  isSessionToken,
  markSignedIn,
  setSessionToken,
  telegramInitData,
} from "../lib/auth";

/**
 * Client auth state.
 *
 * The token itself lives in lib/auth.ts (localStorage session, or Telegram
 * initData / dev fallback). This provider exposes who you are via /api/me and
 * guards the app: every route under <RequireAuth> bounces to /login when
 * there's no usable identity.
 *
 * There is no sign-up: on first open the provider silently enters the app —
 * Telegram initData when inside the Mini App, otherwise a persistent guest
 * account keyed to this device. The Login screen handles explicit username
 * sign-in and registration (after sign-out, or on a second device).
 */

function hasExternalIdentity(): boolean {
  const token = currentAuthToken();
  if (!token) return false; // explicit sign-out or production guest — force the Login screen
  // Session tokens are checked via /api/me below; initData and dev:* count as
  // direct identities (server validates them on the /me call anyway).
  // telegramInitData() also covers init data recovered from the launch URL when
  // the SDK script was blocked, so a Telegram user is still not bounced to Login.
  return isSessionToken(token) || token.startsWith("dev:") || Boolean(telegramInitData());
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => api.getMe(),
    retry: false,
    staleTime: 5 * 60_000,
  });

  // A 401 from /me means the stored session is dead — drop it so the guard
  // sends the user to /login instead of looping on a stale token.
  useEffect(() => {
    if (meQuery.error && (meQuery.error as ApiRequestError).status === 401) {
      const token = currentAuthToken();
      if (isSessionToken(token)) setSessionToken("", false);
    }
  }, [meQuery.error]);

  const applyAuthSuccess = useCallback(
    (token: string, remember: boolean) => {
      setSessionToken(token, remember);
      markSignedIn();
      void qc.invalidateQueries();
    },
    [qc],
  );

  // --- silent entry -------------------------------------------------------
  // First open (no stored session, not signed out): exchange the device id —
  // plus Telegram initData when present — for a session. Telegram wins, so
  // Mini App users are their Telegram account from the very first request.
  // `entering` starts true when auto-entry is pending so the route guard waits
  // instead of flashing the Login screen for a frame.
  const enteredRef = useRef(false);
  // An explicit ?devUser= opts out of device auto-entry (see hasExplicitDevUser).
  // `entering` has to opt out too, or the guard would wait forever for an
  // entry this branch deliberately never performs.
  const devRequested = hasExplicitDevUser();
  const [entering, setEntering] = useState(
    () => !devRequested && !isSessionToken(getSessionToken()) && !isLoggedOut(),
  );
  const needsAutoEntry = !devRequested && !isSessionToken(getSessionToken()) && !isLoggedOut();

  const enterApp = useCallback(async () => {
    if (enteredRef.current) return;
    enteredRef.current = true;
    setEntering(true);
    try {
      // Wait out the SDK before reading initData: older Telegram clients
      // inject telegram-web-app.js late, and racing it turned the Telegram
      // login into a guest account with no bot pushes.
      await waitForTelegram();
      const initData = telegramInitData();
      const res = await api.guest(getDeviceId(), initData);
      if (!res.ok) throw new Error("GUEST_ENTRY_FAILED");
      // Persistent slot either way: entry must survive restarts.
      applyAuthSuccess(res.token, true);
    } catch (err) {
      console.error(`[auth] enterApp failed:`, err);
      enteredRef.current = false; // allow a retry from the Login screen
      throw err;
    } finally {
      setEntering(false);
    }
  }, [applyAuthSuccess]);

  // Auto-entry with retries: a cold webview (server waking, SDK arriving)
  // used to burn the single attempt and dump the user on Login.
  useEffect(() => {
    if (!needsAutoEntry) return;
    let cancelled = false;
    const attempt = async (delayMs: number) => {
      await new Promise((r) => setTimeout(r, delayMs));
      if (cancelled) return;
      try {
        await enterApp();
      } catch {
        // Retries land here; the last failure surfaces via /me → Login screen.
      }
    };
    void attempt(0);
    void attempt(1200);
    void attempt(3000);
    return () => {
      cancelled = true;
    };
  }, [needsAutoEntry, enterApp]);

  // Silent re-entry inside Telegram: when a stored session dies (TTL, server
  // reset) but initData is present, exchange it for a fresh session instead
  // of showing a Login screen that makes no sense inside the webview.
  useEffect(() => {
    if (
      meQuery.error &&
      (meQuery.error as ApiRequestError).status === 401 &&
      isTelegram() &&
      !isLoggedOut()
    ) {
      enteredRef.current = false;
      void enterApp().catch(() => {
        /* stay on the guard; Login remains the fallback */
      });
    }
  }, [meQuery.error, enterApp]);

  const loginWithUsername = useCallback(
    async (username: string, password: string, remember: boolean) => {
      const res = await api.loginWithUsername(username, password);
      applyAuthSuccess(res.token, remember);
    },
    [applyAuthSuccess],
  );

  const registerWithUsername = useCallback(
    async (username: string, password: string, displayName: string, remember: boolean) => {
      const res = await api.register(username, password, displayName || undefined);
      applyAuthSuccess(res.token, remember);
    },
    [applyAuthSuccess],
  );

  const updateDisplayName = useCallback(
    async (displayName: string) => {
      await api.updateDisplayName(displayName);
      // Awaited so the Profile header shows the new name the moment the sheet
      // closes (the /me query is active, so invalidate triggers a refetch).
      await qc.invalidateQueries({ queryKey: ["me"] });
    },
    [qc],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* token may already be dead; clearing locally is what matters */
    }
    clearSession();
    enteredRef.current = false; // the entry screen must be able to enter again
    qc.clear();
  }, [qc]);

  const user = useMemo<AuthUser | null>(() => {
    if (!meQuery.data) return null;
    const u = meQuery.data.user;
    return {
      id: u.id,
      displayName: u.display_name,
      username: u.username ?? null,
      authMode: meQuery.data.authMode ?? "telegram",
    };
  }, [meQuery.data]);

  // Plain call, not a memo: it is a cheap localStorage read, and it has to
  // reflect a login/logout that happened outside this component's state — a
  // memo keyed on the wrong thing both lied to the linter and could go stale.
  const remembered = isRemembered();

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading: (hasExternalIdentity() || entering) && (meQuery.isLoading || entering),
      remembered,
      enterApp,
      loginWithUsername,
      registerWithUsername,
      updateDisplayName,
      logout,
    }),
    [
      user,
      meQuery.isLoading,
      entering,
      remembered,
      enterApp,
      loginWithUsername,
      registerWithUsername,
      updateDisplayName,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Route guard: renders the app only when /me succeeded (or an external
 * identity exists and is still loading). Everything else bounces to /login,
 * remembering where the user wanted to go.
 */
export function RequireAuth() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (user) return <Outlet />;
  if (isLoading) return null; // AppShell renders chrome; keep it blank meanwhile.
  return <Navigate to="/login" replace state={{ from: location.pathname }} />;
}
