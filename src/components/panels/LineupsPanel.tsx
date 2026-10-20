import { useState } from "react";
import { useI18n } from "../../i18n/context";
import type { LineupPlayer, MatchLineup, Team } from "../../types";
import { Card, Chip, Num, PlayerAvatar, Segmented, TeamBadge } from "../ui";
import { placePublishedXI, type SlotCandidate } from "../../lib/formations";

/** `LineupPlayer` → the shape the placement helpers reason about. */
const asCandidate = (player: LineupPlayer): SlotCandidate => ({
  id: player.id,
  espnPosition: player.espnPosition ?? null,
  // A missing shirt number is not number 0 (0 is a legal keeper number).
  jersey: player.number > 0 ? player.number : null,
  unit: player.position,
  formationPlace: player.formationPlace ?? null,
});

/**
 * The published XI on a pitch: turf, markings, and the eleven standing in the
 * shape they were named in.
 *
 * The shape comes from ESPN's own `formation` string when it is one the
 * catalogue knows AND the XI fits it, so a 4-2-3-1 really draws a holding pair
 * and an attacking three (see `placePublishedXI`, which also folds ESPN's
 * winger-as-midfielder habit back into the forward band). When the feed leaves
 * the shape blank, sends a form the catalogue doesn't carry, or the XI simply
 * does not fit it, the rows are derived from what the XI contains — one band
 * per unit — so a leaked lineup still shows every player it has instead of an
 * assumed 4-3-3 that drops the extras.
 *
 * Attack is at the top, the keeper's goal at the bottom (`pitchRows`). The
 * block inherits the page direction, so in the FA (RTL) layout the shape
 * mirrors — the left-back reads from the right and a side attacks toward the
 * same edge it does in its own half of the pitch. The painted markings stay
 * where they are: every one is horizontally centred, so a mirrored row of
 * players still lines up with the penalty areas and the halfway line.
 */
function LineupPitch({ lineup }: { lineup: MatchLineup }) {
  const { t, localize } = useI18n();
  // Carries the player itself plus the fields the placement helpers read, so a
  // placed slot can still render a face and a name.
  const candidates = lineup.starters.map((player) => ({ ...player, ...asCandidate(player) }));
  const { rows, slots } = placePublishedXI(lineup.formation, candidates);

  if (rows.length === 0) return null;

  return (
    <div>
      <p className="mb-1 text-center label text-ink-3">↑ {t("shot.attackingEnd")}</p>
      <div className="relative overflow-hidden rounded-card border border-line bg-pitch/20 p-2">
        {/* One big pitch (~280px), not two small ones: the rows are spread
            evenly down the full height so an XI breathes on a phone. */}
        <div className="relative flex min-h-[264px] flex-col justify-evenly gap-2.5">
          {rows.map((row, rowIndex) => (
            <div key={`${row.unit}-${row.size}-${row.goal ? "g" : "f"}`} className="flex items-start gap-1">
              {slots[rowIndex].map((player, index) => (
                <PitchSlot
                  key={player ? player.id : `empty-${rowIndex}-${index}`}
                  player={player}
                  name={player ? localize(player.name) : ""}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Markings, painted over the slots in the real pitch's proportions —
            goal lines, penalty areas, six-yard boxes, spots, halfway line and
            centre circle — so a band reads as a place on a pitch rather than a
            row of avatars. Purely decorative and pointer-transparent. */}
        <div className="pointer-events-none absolute inset-2" aria-hidden="true">
          <span className="absolute inset-x-0 top-0 h-px bg-white/30" />
          <span className="absolute inset-x-0 bottom-0 h-px bg-white/40" />
          <span className="absolute bottom-0 left-1/2 h-[16%] w-[57%] -translate-x-1/2 border-x border-t border-white/25" />
          <span className="absolute bottom-0 left-1/2 h-[6%] w-[28%] -translate-x-1/2 border-x border-t border-white/20" />
          <span className="absolute bottom-[11%] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/50" />
          <span className="absolute top-1/2 left-1/2 aspect-square h-[22%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
          <span className="absolute inset-x-0 top-1/2 h-px bg-white/15" />
          <span className="absolute top-0 left-1/2 h-[14%] w-[51%] -translate-x-1/2 border-x border-b border-white/15" />
        </div>
      </div>
    </div>
  );
}

/** One player on the pitch: face (or initials), shirt number, name. */
function PitchSlot({ player, name }: { player: LineupPlayer | null; name: string }) {
  if (!player) {
    return (
      <span className="flex min-w-0 flex-1 justify-center">
        <span className="h-10 w-10 rounded-full border border-dashed border-white/25" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-1 flex-col items-center">
      <span className="relative">
        <PlayerAvatar name={name} src={player.headshot} size="md" className="border-pitch/60" />
        <Num className="absolute -end-1 -bottom-1 grid h-4 min-w-4 place-items-center rounded-full bg-volt px-0.5 text-xs leading-none text-black">
          {player.number > 0 ? player.number : "–"}
        </Num>
      </span>
      <span className="mt-1 block w-full truncate text-center text-xs font-bold text-ink-2">{name}</span>
    </span>
  );
}

/**
 * The official lineups, as they were published: the shape drawn on a pitch,
 * then the bench below it. Two sides, one at a time, because an XI on a phone
 * is already a lot of names.
 */
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

      <Card className="p-3">
        <div className="mb-3 flex items-center gap-2">
          <TeamBadge team={team} size="sm" />
          <span className="text-sm font-bold text-ink">{localize(team.shortName)}</span>
          <span className="flex-1" />
          <Chip tone="pitch">{lineup.formation}</Chip>
        </div>

        <LineupPitch lineup={lineup} />

        {/* The coach is not in every feed, and the lineups route has no coach
            endpoint at all — a bare "Coach:" label is worse than no line. */}
        {lineup.coach ? (
          <p className="mt-3 border-t border-line pt-2 text-xs text-ink-3">
            {t("lineups.coach")}: {localize(lineup.coach)}
          </p>
        ) : null}
      </Card>

      {/* The bench, as a horizontal strip of small chips: shirt number over
            the name's initial. A row per sub made the bench longer than the
            pitch; a scroll keeps it to one line. Chips are LTR-safe: numbers
            are figures and an initial is direction-neutral. */}
      {lineup.subs.length > 0 ? (
        <Card className="p-3">
          <p className="mb-2 label text-ink-2">{t("lineups.bench")}</p>
          <ul className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-1">
            {lineup.subs.map((player) => (
              <li key={player.id} className="flex-none">
                <div
                  className="flex w-[52px] flex-col items-center gap-1 rounded-card border border-line bg-surface p-2 text-center"
                  title={localize(player.name)}
                >
                  <Num className="grid h-6 w-6 place-items-center rounded-full bg-elevated px-0.5 text-xs font-black text-ink-2">
                    {player.number > 0 ? player.number : "–"}
                  </Num>
                  <span className="w-full truncate text-xs font-bold text-ink">
                    {localize(player.name).slice(0, 1)}.
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
