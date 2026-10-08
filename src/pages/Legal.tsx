import { TopBar } from "../components/TopBar";
import { Card } from "../components/ui";
import { useI18n } from "../i18n/context";
import { LEGAL_SECTIONS, LEGAL_TITLES, type LegalKind } from "../lib/legal";

/**
 * One legal document, rendered from the {title, body} list in lib/legal.ts.
 * Layout is direction-agnostic (logical spacing only), so the same component
 * is correct in EN (ltr) and FA (rtl) without a branch.
 */
export function LegalPage({ kind }: { kind: LegalKind }) {
  const { t } = useI18n();
  return (
    <>
      <TopBar title={t(LEGAL_TITLES[kind])} />
      <div className="mt-3 space-y-3 pb-8">
        {LEGAL_SECTIONS[kind].map((section) => (
          <Card key={section.title} className="p-4">
            <h2 className="text-sm font-bold text-ink">{t(section.title)}</h2>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-2">{t(section.body)}</p>
          </Card>
        ))}
        <p className="px-1 text-[11px] text-ink-3">{t("legal.updated")}</p>
      </div>
    </>
  );
}

export function Privacy() {
  return <LegalPage kind="privacy" />;
}

export function Terms() {
  return <LegalPage kind="terms" />;
}
