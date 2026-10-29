import { useState } from "react";
import { useI18n } from "../../i18n/context";
import type { LineupPlayer, LineupPlayerEvents, MatchLineup, Team } from "../../types";
import { Card, Chip, Num, PlayerAvatar, Segmented, TeamBadge } from "../ui";
import { BallIcon } from "../icons";
import { cx } from "../../lib/cx";
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
export function LineupPitch({
  lineup,
  playerEvents,
}: {
  lineup: MatchLineup;
  playerEvents?: Record<string, LineupPlayerEvents>;
}) {
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
                  events={player ? playerEvents?.[player.id] : undefined}
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

type CardKind = NonNullable<LineupPlayerEvents["card"]>;

/** The booking itself, drawn the way the timeline draws it: a filled rectangle,
 *  yellow or red, or the overlapping pair ESPN describes as a second yellow. */
function CardMark({ kind }: { kind: CardKind }) {
  if (kind === "second-yellow") {
    return (
      <span aria-hidden="true" className="relative inline-block h-3 w-3">
        <span className="absolute inset-y-0 end-0 w-[7px] rounded-[1px] bg-danger shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" />
        <span className="absolute inset-y-0 start-0 w-[7px] rounded-[1px] bg-gold shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-block h-3 w-2 rounded-[1px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]",
        kind === "red" ? "bg-danger" : "bg-gold",
      )}
    />
  );
}

/**
 * What this player actually did, as small marks under his name: a ball per goal
 * (the timeline's own --volt ball), an outlined "A" for an assist, and the
 * booking's rectangle. Drawn marks, never emoji — the rule the timeline set.
 *
 * A brace is two balls rather than a count: at 12px a digit is unreadable, and
 * one goal is the common case anyway. The whole cluster carries one label, so a
 * screen reader hears "2 goals · Yellow card" once instead of per glyph.
 */
function PlayerMarks({ events }: { events?: LineupPlayerEvents }) {
  const { t } = useI18n();
  if (!events) return null;
  const card =
    events.card === "red" || events.card === "second-yellow"
      ? t("timeline.red")
      : events.card === "yellow"
        ? t("timeline.yellow")
        : "";
  const label = [
    events.goals > 0
      ? events.goals === 1
        ? t("lineups.goalsOne", { count: events.goals })
        : t("lineups.goals", { count: events.goals })
      : "",
    events.assists > 0
      ? events.assists === 1
        ? t("lineups.assistsOne", { count: events.assists })
        : t("lineups.assists", { count: events.assists })
      : "",
    card,
  ]
    .filter(Boolean)
    .join(" · ");
  if (!label) return null;

  return (
    <span
      className="mt-0.5 flex flex-wrap items-center justify-center gap-0.5"
      role="img"
      aria-label={label}
      title={label}
    >
      {Array.from({ length: events.goals }, (_, i) => (
        <BallIcon key={`goal-${i}`} className="h-3 w-3 flex-none text-volt" />
      ))}
      {events.assists > 0 ? (
        <span
          aria-hidden="true"
          className="grid h-3 min-w-3 place-items-center rounded-[2px] px-0.5 text-[9px] leading-none font-black text-ink-2 ring-1 ring-line"
        >
          A
        </span>
      ) : null}
      {events.card ? <CardMark kind={events.card} /> : null}
    </span>
  );
}

/** One player on the pitch: face (or initials), shirt number, name, and — once
 *  the match has been played — what he did in it. */
function PitchSlot({
  player,
  name,
  events,
}: {
  player: LineupPlayer | null;
  name: string;
  events?: LineupPlayerEvents;
}) {
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
        <PlayerAvatar name={name} src={player.avatarUrl}
          fallbackSrc={player.headshotUrl} size="md" className="border-pitch/60" />
        <Num className="absolute -end-1 -bottom-1 grid h-4 min-w-4 place-items-center rounded-full bg-volt px-0.5 text-xs leading-none text-black">
          {player.number > 0 ? player.number : "–"}
        </Num>
      </span>
      <span className="mt-1 block w-full truncate text-center text-xs font-bold text-ink-2">{name}</span>
      <PlayerMarks events={events} />
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
  playerEvents,
}: {
  home: Team;
  away: Team;
  lineups: { home: MatchLineup; away: MatchLineup };
  /**
   * Per-player goals/assists/bookings and sub minutes, keyed by player id.
   * Absent (or empty) for a match that has not been played yet — the pitch then
   * renders exactly as it did before the marks existed.
   */
  playerEvents?: Record<string, LineupPlayerEvents>;
}) {
  const { t, localize } = useI18n();
  const [side, setSide] = useState<"home" | "away">("home");

  const team = side === "home" ? home : away;
  const lineup = side === "home" ? lineups.home : lineups.away;
  // A bench player with a sub-on minute is a substitution that was actually
  // made: he moves to "Subs used" with his minute, and the bench strip keeps
  // the players who never came on. Without events (an upcoming fixture) every
  // bench player stays on the bench, exactly as before.
  const cameOn = lineup.subs.filter((player) => playerEvents?.[player.id]?.subInMinute);
  const bench = lineup.subs.filter((player) => !playerEvents?.[player.id]?.subInMinute);

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

        <LineupPitch lineup={lineup} playerEvents={playerEvents} />

        {/* The coach is not in every feed, and the lineups route has no coach
            endpoint at all — a bare "Coach:" label is worse than no line. */}
        {lineup.coach ? (
          <p className="mt-3 border-t border-line pt-2 text-xs text-ink-3">
            {t("lineups.coach")}: {localize(lineup.coach)}
          </p>
        ) : null}
      </Card>

      {/* The bench, as far as it was used: who came on, and at what minute.
            Only rendered when the timeline gave us a sub event, so a fixture
            with no events still shows just the XI and the bench. */}
      {cameOn.length > 0 ? (
        <Card className="p-3">
          <p className="mb-1 label text-ink-2">{t("lineups.subsUsed")}</p>
          <ul className="divide-y divide-line">
            {cameOn.map((player) => (
              <li key={player.id} className="flex items-center gap-2 py-1.5">
                <Num className="grid h-6 w-6 flex-none place-items-center rounded-full bg-elevated text-xs font-black text-ink-2">
                  {player.number > 0 ? player.number : "–"}
                </Num>
                <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                  {localize(player.name)}
                </span>
                <PlayerMarks events={playerEvents?.[player.id]} />
                <span className="flex-none text-xs font-bold text-pitch">
                  ↑ {playerEvents?.[player.id]?.subInMinute}′
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* The bench, as a horizontal strip of small chips: shirt number over
            the name's initial. A row per sub made the bench longer than the
            pitch; a scroll keeps it to one line. Chips are LTR-safe: numbers
            are figures and an initial is direction-neutral. */}
      {bench.length > 0 ? (
        <Card className="p-3">
          <p className="mb-2 label text-ink-2">{t("lineups.bench")}</p>
          <ul className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-1">
            {bench.map((player) => (
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
