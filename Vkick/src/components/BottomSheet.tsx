import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n/I18nProvider";
import { cx } from "./ui";
import { CloseIcon } from "./icons";

/**
 * Bottom sheet — the sheet in the design system's `--bg-elevated` treatment.
 * Slides up, drags down to dismiss, locks background scroll, closes on Escape.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  // Whatever had focus before the sheet opened gets it back on close.
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setDragY(0);
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Move focus into the dialog so keyboard and AT users are in the sheet,
    // not behind it.
    sheetRef.current?.focus();

    const FOCUSABLE =
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      // Trap Tab inside the sheet: the page behind it is inert to the keyboard.
      if (event.key !== "Tab") return;
      const root = sheetRef.current;
      if (!root) return;
      const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      );
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) {
        event.preventDefault();
        root.focus();
        return;
      }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === root)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
      const restore = restoreRef.current;
      if (restore && document.contains(restore)) restore.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="backdrop-fade absolute inset-0 bg-black/65" onClick={onClose} aria-hidden="true" />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="sheet-in relative w-full max-w-[560px] rounded-t-[20px] border border-line bg-elevated outline-none"
        style={{
          transform: dragY ? `translateY(${dragY}px)` : undefined,
          paddingBottom: "max(env(safe-area-inset-bottom), 16px)",
        }}
      >
        {/* Drag handle: drag down past 90px to dismiss. */}
        <div
          className="flex cursor-grab touch-none justify-center pt-3 pb-1 active:cursor-grabbing"
          onPointerDown={(event) => {
            dragStart.current = event.clientY;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (dragStart.current === null) return;
            setDragY(Math.max(0, event.clientY - dragStart.current));
          }}
          onPointerUp={() => {
            if (dragY > 90) onClose();
            dragStart.current = null;
            setDragY(0);
          }}
        >
          <span className="h-1 w-10 rounded-full bg-line" aria-hidden="true" />
        </div>

        <div className="flex items-start gap-3 border-b border-line px-4 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-ink">{title}</h2>
            {subtitle ? <p className="truncate text-xs text-ink-2">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="grid h-11 w-11 flex-none place-items-center rounded-full border border-line text-ink-2 transition-colors duration-[var(--t-fast)] hover:bg-surface hover:text-ink"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[68svh] overflow-y-auto overscroll-contain px-4 py-3">{children}</div>

        {footer ? <div className="border-t border-line px-4 pt-3">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/** Confirm/cancel row used by most sheets. */
export function SheetActions({ children }: { children: ReactNode }) {
  return <div className={cx("flex gap-2")}>{children}</div>;
}
