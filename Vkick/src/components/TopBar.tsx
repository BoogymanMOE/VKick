import { useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/I18nProvider";
import { haptic } from "../lib/telegram";
import { ChevronLeftIcon, GlobeIcon } from "./icons";
import { cx } from "./ui";

export function TopBar({
  title,
  subtitle,
  back = false,
  right,
}: {
  title: string;
  subtitle?: string;
  back?: boolean;
  right?: React.ReactNode;
}) {
  const navigate = useNavigate();
  const { dir, t } = useI18n();

  return (
    <header className="pad-safe-top sticky top-0 z-20 border-b border-line bg-base/95 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[560px] items-center gap-3 px-3 pb-3">
        {back ? (
          <button
            type="button"
            onClick={() => {
              haptic("light");
              navigate(-1);
            }}
            aria-label={t("common.back")}
            className="-ms-1 grid h-11 w-11 flex-none place-items-center rounded-full border border-line text-ink transition-colors duration-[var(--t-fast)] hover:bg-elevated"
          >
            {/* The chevron points toward the start edge, which flips in RTL. */}
            <span className={cx(dir === "rtl" && "block rotate-180")}>
              <ChevronLeftIcon />
            </span>
          </button>
        ) : null}

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold text-ink">{title}</h1>
          {subtitle ? <p className="truncate text-xs text-ink-2">{subtitle}</p> : null}
        </div>

        {right}
        <LanguageToggle />
      </div>
    </header>
  );
}

/**
 * EN/FA switch. Kept in the shell rather than a settings screen because Persian
 * is a v1 launch language, not a preference buried two taps down.
 */
export function LanguageToggle() {
  const { lang, toggleLang, t } = useI18n();
  return (
    <button
      type="button"
      onClick={() => {
        haptic("light");
        toggleLang();
      }}
      title={t("profile.language")}
      aria-label={t("profile.language")}
      className="flex min-h-11 flex-none items-center gap-1.5 rounded-full border border-line px-3 text-xs font-bold text-ink-2 transition-colors duration-[var(--t-fast)] hover:bg-elevated hover:text-ink"
    >
      <GlobeIcon />
      <span className="uppercase">{lang}</span>
    </button>
  );
}
