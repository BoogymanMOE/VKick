import { useLocation } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { Button, Card } from "../components/ui";
import { useI18n } from "../i18n/I18nProvider";

/**
 * Unknown route. The wildcard used to redirect to /browse silently, which hid
 * broken deep links from the bot and from shared URLs; an explicit screen
 * makes the mistake visible and gives the user a way back.
 */
export default function NotFound() {
  const { t } = useI18n();
  const location = useLocation();

  return (
    <>
      <TopBar title={t("notFound.title")} back />
      <Card className="mt-6 flex flex-col items-center p-6 text-center">
        <p className="font-num text-4xl font-black text-ink-3" aria-hidden="true">
          404
        </p>
        <p className="mt-2 text-sm font-bold text-ink">{t("notFound.body")}</p>
        <p className="mt-1 break-all text-[11px] text-ink-3">{location.pathname}</p>
        <Button className="mt-4" onClick={() => window.history.back()}>
          {t("common.back")}
        </Button>
        <p className="mt-3 text-[11px] text-ink-3">{t("notFound.browse")}</p>
      </Card>
    </>
  );
}
