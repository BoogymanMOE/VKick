import { useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { BottomSheet } from "./BottomSheet";
import { InfoIcon } from "./icons";
import { cx } from "./ui";

const RULE_KEYS = [
  "rules.lineup",
  "rules.sub",
  "rules.shot",
  "rules.watch",
  "rules.versus",
  "rules.streak",
] as const;

/**
 * The scoring rules, inside the product. They used to live only in
 * scoring-rules.md, so a "+3" on screen had nothing explaining where it came
 * from and every lock window read as arbitrary. One control opens one sheet;
 * the Predictions hub and the boards share the same copy, so the rules cannot
 * drift between the place you earn points and the place you spend them.
 *
 * Values are copied from scoring-rules.md (the locked tables), not re-derived.
 *
 * `variant="icon"` is the compact circular button for a TopBar slot;
 * `variant="link"` is a labelled text action for inline copy, where an icon
 * alone would carry no standalone meaning for a screen reader.
 */
export function RulesButton({
  variant = "icon",
  className,
}: {
  variant?: "icon" | "link";
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={variant === "icon" ? t("rules.title") : undefined}
        className={
          variant === "icon"
            ? cx(
                "grid h-11 w-11 flex-none place-items-center rounded-full border border-line text-ink-2 transition-colors duration-[var(--t-fast)] hover:bg-elevated hover:text-ink",
                className,
              )
            : cx(
                "-my-2 inline-flex min-h-11 flex-none items-center px-1 text-[11px] font-bold text-volt transition-colors duration-[var(--t-fast)] hover:underline",
                className,
              )
        }
      >
        {variant === "icon" ? <InfoIcon /> : t("rules.title")}
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title={t("rules.title")}>
        <p className="text-sm leading-relaxed text-ink-2">{t("rules.intro")}</p>
        <ul className="mt-3 divide-y divide-line border-y border-line">
          {RULE_KEYS.map((key) => (
            <li key={key} className="py-2.5 text-xs leading-relaxed text-ink-2">
              {t(key)}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-3">{t("rules.settle")}</p>
      </BottomSheet>
    </>
  );
}
