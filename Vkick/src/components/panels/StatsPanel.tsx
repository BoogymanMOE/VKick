import type { StringKey } from "../../i18n/strings";
import { useI18n } from "../../i18n/I18nProvider";
import type { Team, TeamStats } from "../../types";
import { Card, Num, StatBar, TeamBadge } from "../ui";

const rows: Array<{ key: keyof TeamStats; label: StringKey; suffix?: string }> = [
  { key: "possession", label: "stats.possession", suffix: "%" },
  { key: "shots", label: "stats.shots" },
  { key: "shotsOnTarget", label: "stats.onTarget" },
  { key: "corners", label: "stats.corners" },
  { key: "fouls", label: "stats.fouls" },
  { key: "offsides", label: "stats.offsides" },
  { key: "saves", label: "stats.saves" },
  { key: "passAccuracy", label: "stats.passAccuracy", suffix: "%" },
];

export function StatsPanel({
  home,
  away,
  stats,
}: {
  home: Team;
  away: Team;
  stats: { home: TeamStats; away: TeamStats };
}) {
  const { t, localize } = useI18n();

  return (
    <Card className="p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-bold text-ink">
          <TeamBadge team={home} size="sm" />
          {localize(home.shortName)}
        </span>
        <span className="flex flex-row-reverse items-center gap-2 text-xs font-bold text-ink">
          <TeamBadge team={away} size="sm" />
          {localize(away.shortName)}
        </span>
      </div>

      <ul className="space-y-3">
        {rows.map(({ key, label, suffix }) => (
          <StatBar
            key={key}
            label={t(label) + (suffix ?? "")}
            home={stats.home[key]}
            away={stats.away[key]}
            homeColor={home.color}
            awayColor={away.color}
          />
        ))}
      </ul>

      <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-[11px] text-ink-3">
        <span>{t("stats.source")}</span>
        <Num>{t("stats.live")}</Num>
      </div>
    </Card>
  );
}
