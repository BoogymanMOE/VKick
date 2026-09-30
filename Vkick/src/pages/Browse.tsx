import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { TopBar } from "../components/TopBar";
import { CompRowSkeleton } from "../components/Skeletons";
import { Chip, Num, SectionHeading, cx } from "../components/ui";
import { useCompetitions } from "../hooks/useApi";
import { useI18n } from "../i18n/I18nProvider";
import { haptic } from "../lib/telegram";

/**
 * The Browse screen: everything ESPN serves, grouped into leagues, cups and
 * international tournaments. Synced competitions deep-link into Matches/Cups
 * with a league filter; coming-soon ones (extra ESPN slugs, not yet synced)
 * show a disabled row so users see the scope without dead-ends.
 */
export default function Browse() {
  const { t, localize } = useI18n();
  const navigate = useNavigate();
  const query = useCompetitions();

  const [filter, setFilter] = useState<"all" | "league" | "cup">("all");

  const groups = useMemo(() => {
    const comps = query.data?.competitions ?? [];
    const visible = comps.filter((c) => (filter === "all" ? true : c.kind === filter));
    return {
      leagues: visible.filter((c) => c.kind === "league"),
      cups: visible.filter((c) => c.kind === "cup"),
      tournaments: visible.filter((c) => c.kind === "tournament"),
    };
  }, [query.data, filter]);

  const sections: Array<{ title: string; rows: typeof groups.leagues }> = [
    { title: t("browse.leagues"), rows: groups.leagues },
    { title: t("browse.cups"), rows: groups.cups },
    ...(groups.tournaments.length > 0 ? [{ title: t("browse.tournaments"), rows: groups.tournaments }] : []),
  ];

  const open = (slug: string, comingSoon: boolean | undefined, kind: string) => {
    if (comingSoon) return;
    haptic("light");
    if (kind === "league") navigate(`/matches?league=${encodeURIComponent(slug)}`);
    else navigate(`/cups?cup=${encodeURIComponent(slug)}`);
  };

  return (
    <>
      <TopBar title={t("browse.title")} subtitle={t("browse.subtitle")} />

      <div
        className="mt-3 grid grid-cols-3 gap-1 rounded-full border border-line bg-surface p-1"
        role="tablist"
      >
        {(
          [
            ["all", "browse.all"],
            ["league", "browse.leagues"],
            ["cup", "browse.cups"],
          ] as const
        ).map(([value, key]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => {
              haptic("light");
              setFilter(value);
            }}
            className={cx(
              "min-h-11 rounded-full text-xs font-bold transition-colors duration-[var(--t-fast)]",
              filter === value ? "bg-elevated text-volt" : "text-ink-2 hover:text-ink",
            )}
          >
            {t(key)}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="mt-4">
          <CompRowSkeleton rows={6} />
        </div>
      ) : (
        sections.map(
          ({ title, rows }) =>
            rows.length > 0 && (
              <section key={title} className="mt-5">
                <SectionHeading
                  title={title}
                  action={
                    <Chip tone="muted">
                      <Num>{rows.length}</Num>
                    </Chip>
                  }
                />
                <ul className="space-y-2">
                  {rows.map((comp) => {
                    const soon = Boolean(comp.comingSoon);
                    const Wrapper = soon ? "div" : "button";
                    return (
                      <li key={comp.slug}>
                        <Wrapper
                          {...(soon
                            ? {}
                            : {
                                type: "button" as const,
                                onClick: () => open(comp.slug, comp.comingSoon, comp.kind),
                              })}
                          className={cx(
                            "flex w-full items-center gap-3 rounded-card border p-3 text-start transition-colors duration-[var(--t-fast)]",
                            soon
                              ? "border-dashed border-line bg-transparent opacity-70"
                              : "border-line bg-surface hover:bg-elevated",
                          )}
                        >
                          <span
                            className={cx(
                              "grid h-9 w-9 flex-none place-items-center rounded-full border text-xs font-extrabold",
                              soon ? "border-line text-ink-3" : "border-volt text-volt",
                            )}
                            style={{
                              backgroundColor: soon
                                ? undefined
                                : "color-mix(in srgb, var(--volt) 12%, transparent)",
                            }}
                            aria-hidden="true"
                          >
                            {comp.name.slice(0, 1)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold text-ink">
                              {localize(comp.name)}
                            </span>
                            <span className="block truncate text-[11px] text-ink-3">
                              {soon ? t("browse.comingSoon") : t("browse.liveScores")}
                            </span>
                          </span>
                          {soon ? (
                            <Chip tone="muted">{t("browse.soon")}</Chip>
                          ) : (
                            <span className="text-ink-3" aria-hidden="true">
                              ›
                            </span>
                          )}
                        </Wrapper>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ),
        )
      )}
    </>
  );
}
