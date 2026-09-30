import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { api } from "../lib/api";
import {
  clearSession,
  currentAuthToken,
  getDeviceId,
  getSessionToken,
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

export interface AuthUser {
  id: number;
  displayName: string;
  username: string | null;
  authMode: "session" | "telegram" | "dev";
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  /** True when the stored session survives a browser restart (remember me). */
  remembered: boolean;
  /** Silent entry: Telegram initData when available, else a guest account. */
  enterApp: () => Promise<void>;
  /** Sign in with username + password (wrong/unknown share one failure). */
  loginWithUsername: (username: string, password: string, remember: boolean) => Promise<void>;
  /** Explicit registration (the Login screen's "Create account" form). */
  registerWithUsername: (
    username: string,
    password: string,
    displayName: string,
    remember: boolean,
  ) => Promise<void>;
  /** Rename the signed-in user; resolves once /me reflects the new name. */
  updateDisplayName: (displayName: string) => Promise<void>;
  loginWithTelegram: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function hasExternalIdentity(): boolean {
  const token = currentAuthToken();
  if (!token) return false; // explicit sign-out — force the Login screen
  // Session tokens are checked via /api/me below; initData and dev:* count as
  // direct identities (server validates them on the /me call anyway).
  return (
    isSessionToken(token) || token.startsWith("dev:") || Boolean((window as any).Telegram?.WebApp?.initData)
  );
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
    if (meQuery.error && (meQuery.error as any).status === 401) {
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
  const [entering, setEntering] = useState(() => !isSessionToken(getSessionToken()) && !isLoggedOut());
  const needsAutoEntry = !isSessionToken(getSessionToken()) && !isLoggedOut();

  const enterApp = useCallback(async () => {
    if (enteredRef.current) return;
    enteredRef.current = true;
    setEntering(true);
    try {
      const initData = telegramInitData();
      const res = await api.guest(getDeviceId(), initData);
      if (!res.ok) throw new Error("GUEST_ENTRY_FAILED");
      // Persistent slot either way: entry must survive restarts.
      applyAuthSuccess(res.token, true);
    } catch (err) {
      enteredRef.current = false; // allow a retry from the Login screen
      throw err;
    } finally {
      setEntering(false);
    }
  }, [applyAuthSuccess]);

  useEffect(() => {
    if (needsAutoEntry)
      void enterApp().catch(() => {
        /* surfaced via /me failing → Login screen */
      });
  }, [needsAutoEntry, enterApp]);

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

  const loginWithTelegram = useCallback(async () => {
    const initData = (window as any).Telegram?.WebApp?.initData;
    if (!initData) throw new Error("NO_TELEGRAM");
    const res = await api.login();
    if (!res.ok) throw new Error("TELEGRAM_LOGIN_FAILED");
    // The initData itself remains the credential inside the webview; we only
    // needed the server round-trip to upsert the user (and mint a session).
    // Telegram users always get the persistent slot — reopening the mini app
    // is expected to keep them signed in.
    if (res.token) applyAuthSuccess(res.token, true);
  }, [applyAuthSuccess]);

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
      loginWithTelegram,
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
      loginWithTelegram,
      logout,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
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
