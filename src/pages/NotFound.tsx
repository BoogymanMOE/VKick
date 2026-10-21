import { useLocation } from "react-router-dom";
import { AlertIcon } from "../components/icons";
import { TopBar } from "../components/TopBar";
import { Button, Card } from "../components/ui";
import { useI18n } from "../i18n/context";

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
      <Card className="mt-2xl flex flex-col items-center p-6 text-center">
        <AlertIcon className="h-12 w-12 mx-auto mb-4 text-volt" />
        <p className="font-num text-display font-black text-ink-3" aria-hidden="true">
          404
        </p>
        <p className="mt-2 text-sm font-bold text-ink">{t("notFound.body")}</p>
        <p className="mt-1 break-all text-xs text-ink-3">{location.pathname}</p>
        <Button className="mt-lg" onClick={() => window.history.back()}>
          {t("common.back")}
        </Button>
        <p className="mt-md text-xs text-ink-3">{t("notFound.browse")}</p>
      </Card>
    </>
  );
}
