import { useLocation, useNavigate } from "react-router-dom";
import { useI18n } from "../i18n/context";
import { haptic } from "../lib/telegram";
import { ChevronLeftIcon, GlobeIcon } from "./icons";
import { cx } from "../lib/cx";

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
  // A back button on the session's FIRST entry (a shared deep link) has no
  // history to pop: navigate(-1) would leave the mini app entirely. The
  // first entry has React Router's "default" location key — route to the
  // feed instead, replacing the URL so the back gesture can't loop.
  const firstEntry = useLocation().key === "default";
  const goBack = () => {
    if (firstEntry) navigate("/matches", { replace: true });
    else navigate(-1);
  };

  return (
    // No backdrop blur: the bar is 95% opaque, so the blur was invisible while
    // still forcing a full-width backdrop read on every scroll frame — exactly
    // the cost the low-end Android target can't afford.
    <header className="pad-safe-top sticky top-0 z-20 border-b border-line bg-base/95">
      {/* px-[var(--space-page-x)] aligns the header's gutters with the page below
          and pb-4 gives more breathing room from the content underneath. */}
      <div className="mx-auto flex w-full max-w-[560px] items-center gap-3 px-[var(--space-page-x,16px)] pb-4 pt-2">
        {back ? (
          <button
            type="button"
            onClick={() => {
              haptic("light");
              goBack();
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
          {subtitle ? <p className="truncate text-xs text-ink-2">{subtitle}</p> : null}      </div>
        {right}
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
