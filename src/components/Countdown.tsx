import { useEffect, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { cx } from "./ui";

/**
 * Signature animation 7: deadline heat.
 * Under an hour it turns danger red; in the last ten seconds every tick pulses.
 */
export function useCountdown(deadlineAt: string) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const remainingMs = Math.max(0, new Date(deadlineAt).getTime() - now);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const expired = remainingMs <= 0;

  return {
    expired,
    totalSeconds,
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    /** normal → gold, under an hour → danger, last ten seconds → panic pulse. */
    heat: totalSeconds <= 10 ? "panic" : totalSeconds < 3600 ? "danger" : "normal",
  } as const;
}

const pad = (value: number) => String(value).padStart(2, "0");

export function Countdown({
  deadlineAt,
  size = "lg",
  onExpire,
}: {
  deadlineAt: string;
  size?: "sm" | "lg";
  onExpire?: () => void;
}) {
  const { t } = useI18n();
  const { expired, hours, minutes, seconds, heat, totalSeconds } = useCountdown(deadlineAt);

  useEffect(() => {
    if (expired) onExpire?.();
  }, [expired, onExpire]);

  const color = heat === "normal" ? "text-ink" : heat === "danger" ? "text-danger" : "text-danger";

  if (expired) {
    return (
      <span className={cx("font-bold text-danger", size === "lg" ? "text-2xl" : "text-sm")}>
        {t("deadline.locked")}
      </span>
    );
  }

  return (
    <span
      // Remounting per second in panic heat is what animates the pulse.
      key={heat === "panic" ? totalSeconds : "steady"}
      className={cx(
        "num-display tabular-nums inline-flex items-baseline",
        color,
        size === "lg" ? "text-2xl" : "text-base",
        heat === "panic" && "tick-panic",
      )}
    >
      {hours > 0 ? `${pad(hours)}:` : ""}
      {pad(minutes)}:{pad(seconds)}
    </span>
  );
}
