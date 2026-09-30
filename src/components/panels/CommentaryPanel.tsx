import { useI18n } from "../../i18n/I18nProvider";
import { cx } from "../ui";

/**
 * Dense minute-by-minute readout of the match's key events — a read-only
 * layer under the timeline. (The pinned-comment composer was cut with the
 * timeline-comments feature in the v2 concept.)
 */
export interface CommentaryLine {
  id: string;
  minuteDisplay: string;
  text: string;
  isKey?: boolean;
}

export function CommentaryPanel({ lines }: { lines: CommentaryLine[] }) {
  const { t } = useI18n();

  if (lines.length === 0) {
    return <p className="text-center text-xs text-ink-3">{t("commentary.empty")}</p>;
  }

  return (
    <ul className="space-y-1">
      {lines.map((line) => (
        <li
          key={line.id}
          className={cx(
            "flex gap-2 rounded-card px-2 py-1.5 text-xs",
            line.isKey ? "bg-elevated font-bold text-ink" : "text-ink-2",
          )}
        >
          <span className="num-display w-10 flex-none text-end text-[11px] text-ink-3 tabular-nums">
            {line.minuteDisplay}
          </span>
          <span className="min-w-0 flex-1">{line.text}</span>
        </li>
      ))}
    </ul>
  );
}
