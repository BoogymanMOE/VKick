import { createContext, useContext } from "react";

/**
 * Auth context and its hook, kept OUT of `useAuth.tsx` on purpose: React Fast
 * Refresh only preserves component state when a module exports nothing but
 * components, so that file exports `<AuthProvider>` and `<RequireAuth>` alone
 * and every screen reads the session through `useAuth` here.
 *
 * The token itself lives in lib/auth.ts (localStorage session, or Telegram
 * initData / dev fallback); this context exposes who you are via /api/me and
 * is what the route guard reads.
 */
export interface AuthUser {
  id: number;
  displayName: string;
  username: string | null;
  authMode: "session" | "telegram" | "dev";
}

export interface AuthContextValue {
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
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
