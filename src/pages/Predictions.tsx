import { Link } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { CompRowSkeleton } from "../components/Skeletons";
import { Chip, EmptyState, ErrorState, Num, SectionHeading } from "../components/ui";
import { useMyPredictionHistory, type PredictionHistoryRow } from "../hooks/useApi";
import { useI18n } from "../i18n/I18nProvider";
import { breakdownItems, MECHANIC_LABELS, STATUS_LABELS, type BreakdownLang } from "../lib/breakdown";
import { formatKickoff } from "../lib/format";

/**
 * The "why did I get X" panel (roadmap Phase 2). Every pick the caller has made,
 * with the resolver's own line items — the scoring that produced the number,
 * not a separate explanation that could drift from it.
 *
 * Public board identity is the @username, but this page is private history, so
 * it needs no ranking affordances beyond the points each pick earned.
 */
export default function Predictions() {
  const { t, lang, localize } = useI18n();
  const query = useMyPredictionHistory();
  const rows = query.data ?? [];

  const settled = rows.filter((r) => r.status !== "pending");
  const pending = rows.filter((r) => r.status === "pending");

  return (
    <>
      <TopBar title={t("predictions.title")} subtitle={t("predictions.subtitle")} />

      {query.isLoading ? (
        <div className="mt-4">
          <CompRowSkeleton rows={4} />
        </div>
      ) : query.isError ? (
        <div className="mt-4">
          <ErrorState onRetry={() => query.refetch()} />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState title={t("predictions.empty")} hint={t("predictions.emptyHint")} />
        </div>
      ) : (
        <>
          <section className="mt-4">
            <SectionHeading
              title={t("predictions.settled")}
              action={
                <Chip tone="muted">
                  <Num>{settled.length}</Num>
                </Chip>
              }
            />
            {settled.length === 0 ? (
              <EmptyState title={t("predictions.noneSettled")} />
            ) : (
              <ul className="space-y-2">
                {settled.map((row) => (
                  <PredictionCard key={row.id} row={row} lang={lang} localize={localize} />
                ))}
              </ul>
            )}
          </section>

          {pending.length > 0 ? (
            <section className="mt-6">
              <SectionHeading
                title={t("predictions.pending")}
                action={
                  <Chip tone="muted">
                    <Num>{pending.length}</Num>
                  </Chip>
                }
              />
              <ul className="space-y-2">
                {pending.map((row) => (
                  <PredictionCard key={row.id} row={row} lang={lang} localize={localize} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

const STATUS_TONE: Record<string, "volt" | "gold" | "danger" | "muted"> = {
  correct: "volt",
  partial: "gold",
  wrong: "danger",
  void: "muted",
  pending: "muted",
};

function PredictionCard({
  row,
  lang,
  localize,
}: {
  row: PredictionHistoryRow;
  lang: BreakdownLang;
  localize: (text: string) => string;
}) {
  const { t } = useI18n();
  const items = breakdownItems(row.breakdown, lang);
  const hasScore = row.homeScore !== null && row.awayScore !== null;

  return (
    <li className="rounded-card border border-line bg-surface p-3">
      <div className="flex items-center gap-2">
        <Chip tone="pitch" normalCase>
          {MECHANIC_LABELS[row.mechanic]?.[lang] ?? row.mechanic}
        </Chip>
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
          {localize(row.homeShort)} <span className="text-ink-3">v</span> {localize(row.awayShort)}
        </span>
        <Chip tone={STATUS_TONE[row.status] ?? "muted"}>
          {STATUS_LABELS[row.status]?.[lang] ?? row.status}
        </Chip>
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2 text-[11px] text-ink-3">
        <span>
          {row.kickoffAt ? formatKickoff(new Date(row.kickoffAt), lang === "fa" ? "fa-IR" : undefined) : ""}
          {hasScore ? ` · ${row.homeScore}–${row.awayScore}` : ""}
        </span>
        <span className="flex items-center gap-2">
          {row.status === "pending" ? (
            <span className="text-ink-3">{t("predictions.notSettled")}</span>
          ) : (
            <Chip tone={row.points > 0 ? "volt" : "muted"}>
              {t("predictions.points", { points: row.points })}
            </Chip>
          )}
          <Link
            to={`/match/${row.matchId}`}
            className="-my-3 inline-flex min-h-11 items-center px-1 text-[11px] font-bold text-ink-2 transition-colors duration-[var(--t-fast)] hover:text-ink"
          >
            {t("match.summary")}
          </Link>
        </span>
      </div>

      {items.length > 0 ? (
        <dl className="mt-2 space-y-1 border-t border-line pt-2">
          {items.map((item) => (
            <div key={item.key} className="flex items-baseline justify-between gap-3">
              <dt className={`text-[11px] ${item.flag ? "text-ink-3" : "text-ink-2"}`}>{item.label}</dt>
              <dd className={`font-num text-[11px] font-bold ${item.flag ? "text-ink-3" : "text-ink"}`}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}
