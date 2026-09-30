import { useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { LineupPlayer, MatchLineup, Position, Team } from "../../types";
import { Card, Chip, Num, Segmented, TeamBadge, cx } from "../ui";

const order: Position[] = ["GK", "DEF", "MID", "FWD"];

export function LineupsPanel({
  home,
  away,
  lineups,
}: {
  home: Team;
  away: Team;
  lineups: { home: MatchLineup; away: MatchLineup };
}) {
  const { t, localize } = useI18n();
  const [side, setSide] = useState<"home" | "away">("home");

  const team = side === "home" ? home : away;
  const lineup = side === "home" ? lineups.home : lineups.away;

  return (
    <div className="space-y-3">
      <Segmented
        value={side}
        onChange={setSide}
        options={[
          { value: "home", label: localize(home.shortName) },
          { value: "away", label: localize(away.shortName) },
        ]}
      />

      <Card className="pitch-watermark p-3">
        <div className="mb-3 flex items-center gap-2">
          <TeamBadge team={team} size="sm" />
          <span className="text-sm font-bold text-ink">{localize(team.shortName)}</span>
          <span className="flex-1" />
          <Chip tone="muted">{lineup.formation}</Chip>
        </div>

        <div className="space-y-3">
          {order.map((position) => {
            const group = lineup.starters.filter((player) => player.position === position);
            if (group.length === 0) return null;
            return (
              <div key={position} className="flex flex-wrap justify-center gap-1.5">
                {group.map((player) => (
                  <PlayerChip key={player.id} player={player} />
                ))}
              </div>
            );
          })}
        </div>

        <p className="mt-3 border-t border-line pt-2 text-[11px] text-ink-3">
          {t("lineups.coach")}: {localize(lineup.coach)}
        </p>
      </Card>

      <Card className="p-3">
        <p className="mb-2 label text-ink-2">{t("lineups.bench")}</p>
        <ul className="space-y-1.5">
          {lineup.subs.map((player) => (
            <li key={player.id} className="flex items-center gap-2 text-xs">
              <Num className="w-6 flex-none text-ink-3">{player.number}</Num>
              <span className="flex-1 truncate text-ink">{localize(player.name)}</span>
              <Chip tone="muted" normalCase>
                {t(`pos.${player.position}`)}
              </Chip>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function PlayerChip({ player }: { player: LineupPlayer }) {
  const { localize } = useI18n();
  return (
    <div className="w-[68px] text-center">
      <span
        className={cx(
          "mx-auto grid h-8 w-8 place-items-center rounded-full border border-line bg-elevated text-[11px] font-bold text-ink",
        )}
      >
        <Num>{player.number}</Num>
      </span>
      <p className="mt-1 truncate text-[10px] font-bold text-ink-2">{localize(player.name)}</p>
    </div>
  );
}
