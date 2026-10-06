import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { cx } from "../lib/cx";
import { AlertIcon, BallIcon, CloseIcon, RefreshIcon, StarFilledIcon } from "./icons";
import { ToastContext, type ToastItem, type ToastTone } from "./toastContext";

/**
 * Call sites pass a one-character glyph ("★", "✕"); they resolve to the same
 * SVG set as the rest of the app here, so toasts don't drift into system-font
 * symbols sitting next to drawn icons.
 */
const GLYPHS: Record<string, ReactNode> = {
  "★": <StarFilledIcon className="h-4 w-4" />,
  "✕": <CloseIcon className="h-4 w-4" />,
  "↻": <RefreshIcon className="h-4 w-4" />,
  "⚠": <AlertIcon className="h-4 w-4" />,
  "⚽": <BallIcon className="h-4 w-4" />,
};

const toneClass: Record<ToastTone, string> = {
  volt: "border-volt text-volt",
  gold: "border-gold text-gold",
  danger: "border-danger text-danger",
  muted: "border-line text-ink-2",
};

const toneTint: Record<ToastTone, string | undefined> = {
  volt: "color-mix(in srgb, var(--volt) 14%, var(--bg-elevated))",
  gold: "color-mix(in srgb, var(--gold) 14%, var(--bg-elevated))",
  danger: "color-mix(in srgb, var(--danger) 14%, var(--bg-elevated))",
  muted: undefined,
};

/** App-wide transient alerts: goals, deadline warnings, saved confirmations. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((prev) => [...prev.slice(-2), { ...toast, id }]);
    window.setTimeout(() => {
      // Mark leaving rather than remove: the exit animation tells the
      // animationend handler below when it is actually safe to drop it.
      setToasts((prev) => prev.map((item) => (item.id === id ? { ...item, leaving: true } : item)));
    }, 3600);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),10px)]"
        role="status"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            onAnimationEnd={() => {
              // Only the leave reaps the toast; the enter animation also ends
              // here and must be ignored.
              if (toast.leaving) setToasts((prev) => prev.filter((item) => item.id !== toast.id));
            }}
            className={cx(
              "flex w-full max-w-[420px] items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold backdrop-blur-md",
              toast.leaving ? "toast-out" : "toast-in",
              toneClass[toast.tone],
            )}
            style={{ backgroundColor: toneTint[toast.tone] ?? "rgba(18,44,37,0.95)" }}
          >
            {toast.icon ? (
              <span aria-hidden="true" className="flex flex-none items-center">
                {typeof toast.icon === "string" ? (GLYPHS[toast.icon] ?? toast.icon) : toast.icon}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate">{toast.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
