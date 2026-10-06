import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/**
 * The toast context and its hook, kept OUT of `Toast.tsx` on purpose: React
 * Fast Refresh only preserves component state when a module exports nothing
 * but components, so the provider file exports its component alone and every
 * call site reads `push` through `useToast` here.
 */
export type ToastTone = "volt" | "gold" | "danger" | "muted";

export interface ToastItem {
  id: string;
  text: string;
  tone: ToastTone;
  icon?: ReactNode;
  /** Set when the dwell time is up: the toast plays its leave, then unmounts. */
  leaving?: boolean;
}

export const ToastContext = createContext<{ push: (toast: Omit<ToastItem, "id">) => void } | null>(null);

/** App-wide transient alerts: goals, deadline warnings, saved confirmations. */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
