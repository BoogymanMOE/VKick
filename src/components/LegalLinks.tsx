import { Link } from "react-router-dom";
import { useI18n } from "../i18n/context";
import { LEGAL_ROUTES } from "../lib/legal";
import { cx } from "../lib/cx";

/**
 * The compact "Privacy policy · Terms of use" link row. Used on the onboarding
 * screens (where a full section would crowd the primary action) and anywhere
 * else a light-touch legal link belongs. Profile uses its own ListRows.
 */
export function LegalLinks({ className }: { className?: string }) {
  const { t } = useI18n();
  const linkClass = "underline decoration-line underline-offset-2 transition-colors hover:text-ink-2";
  return (
    <p className={cx("text-center text-[11px] text-ink-3", className)}>
      <Link to={LEGAL_ROUTES.privacy} className={linkClass}>
        {t("legal.privacyTitle")}
      </Link>
      <span aria-hidden="true"> · </span>
      <Link to={LEGAL_ROUTES.terms} className={linkClass}>
        {t("legal.termsTitle")}
      </Link>
    </p>
  );
}
