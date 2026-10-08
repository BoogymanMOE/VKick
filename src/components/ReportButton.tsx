import { useState } from "react";
import { api } from "../lib/api";
import { useI18n } from "../i18n/context";
import { useToast } from "./toastContext";
import { cx } from "../lib/cx";

/**
 * One-tap "report" on someone else's comment. The server keeps it to one
 * report per user per comment (a second tap is a no-op), and rate-limits it.
 * Once filed the control latches, so the user gets a clear terminal state.
 */
export function ReportButton({
  commentType,
  commentId,
  className,
}: {
  commentType: "timeline" | "rating";
  commentId: number;
  className?: string;
}) {
  const { t } = useI18n();
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async () => {
    if (busy || done) return;
    setBusy(true);
    try {
      await api.reportComment(commentType, commentId);
      setDone(true);
      push({ text: t("report.done"), tone: "volt", icon: "✓" });
    } catch {
      push({ text: t("report.failed"), tone: "danger", icon: "✕" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={(e) => {
        // Rows are sometimes tappable containers; a report must not open them.
        e.preventDefault();
        e.stopPropagation();
        void submit();
      }}
      disabled={busy || done}
      className={cx(
        "flex-none text-[10px] font-bold text-ink-3 underline-offset-2 transition-colors hover:text-danger hover:underline disabled:opacity-60",
        className,
      )}
    >
      {done ? t("report.done") : t("report.button")}
    </button>
  );
}
