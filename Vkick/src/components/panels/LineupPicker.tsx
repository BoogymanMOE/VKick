import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useMatch, useSquad, type SquadRow } from "../../hooks/useApi";
import { useI18n } from "../../i18n/I18nProvider";
import { haptic, selectionHaptic } from "../../lib/telegram";
import {
  FORMATIONS,
  UNITS,
  XI_SIZE,
  compareSquad,
  fillFormation,
  isValidFormationId,
  isValidXI,
  pitchRows,
  requiredUnits,
  unitTally,
  type SlotCandidate,
  type Unit,
} from "../../lib/formations";
import { Button, Chip, EmptyState, ErrorState, Num, TeamBadge, cx } from "../ui";
import { PanelSkeleton } from "../Skeletons";
import { CheckIcon } from "../icons";

type Side = "home" | "away";

/** SquadRow -> the shape src/lib/formations.ts reasons about. */
const asCandidate = (p: SquadRow): SlotCandidate => ({
  id: p.id,
  espnPosition: p.espnPosition,
  jersey: p.jersey,
  unit: p.position,
});

/**
 * The predicted XI on the pitch, in the chosen shape: attack at the top, the
 * keeper's goal at the bottom, and every player placed by their granular
 * position (a left-back left, a right-back right) rather than dropped into a
 * generic band. Empty slots stay hollow so the shape you're short of is
 * visible without counting.
 */
function LineupPitch({
  formationId,
  squad,
  picked,
}: {
  formationId: string;
  squad: SquadRow[];
  picked: string[];
}) {
  const rows = pitchRows(formationId);
  const candidates = squad.filter((p) => picked.includes(p.id)).map(asCandidate);
  const slots = fillFormation(formationId, candidates);

  return (
    <div className="pitch-watermark rounded-card border border-line bg-base px-3 py-3">
      <div className="flex flex-col gap-1.5">
        {rows.map((row, rowIndex) => (
          <div
            key={`${row.unit}-${row.size}-${row.goal ? "g" : "f"}`}
            className={cx("flex items-center gap-1.5", row.goal && "border-t border-line pt-2")}
          >
            {slots[rowIndex].map((player, index) => (
              <span
                key={player ? player.id : `empty-${rowIndex}-${index}`}
                className={cx(
                  "grid h-6 flex-1 place-items-center rounded-full border text-[10px] font-bold tabular-nums",
                  player ? "border-transparent bg-volt text-black" : "border-line border-dashed text-ink-3",
                )}
              >
                {player?.jersey ?? "·"}
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-2 border-t border-line pt-1.5 text-center text-[10px] text-ink-3">
        {candidates.length}/{XI_SIZE} · {formationId}
      </p>
    </div>
  );
}

function PlayerRow({
  player,
  picked,
  onToggle,
}: {
  player: SquadRow;
  picked: boolean;
  onToggle: () => void;
}) {
  const { t, localize } = useI18n();
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={picked}
        className={cx(
          "flex min-h-11 w-full items-center gap-2.5 rounded-card border p-2 text-start transition-colors duration-[var(--t-fast)]",
          picked ? "border-volt bg-elevated" : "border-line bg-surface hover:bg-elevated",
        )}
      >
        <Num className="grid h-7 w-7 flex-none place-items-center rounded-md border border-line bg-elevated text-[11px] text-ink-2">
          {player.jersey ?? "–"}
        </Num>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-ink">{localize(player.name)}</span>
          {player.appearances ? (
            <span className="block text-[10px] text-ink-3">
              <Num>{player.appearances}</Num> {t("lineup.apps")}
              {player.goals ? (
                <>
                  {" · "}
                  <Num>{player.goals}</Num> {t("lineup.goalsShort")}
                </>
              ) : null}
            </span>
          ) : null}
        </span>
        {player.espnPosition ? (
          <Chip tone="muted" normalCase>
            {player.espnPosition}
          </Chip>
        ) : null}
        {picked ? <CheckIcon className="h-4 w-4 flex-none text-volt" /> : null}
      </button>
    </li>
  );
}

/**
 * Lineup Predictor editor: choose the club, pick exactly 11 starters out of its
 * full squad, and name the formation. Locks 2h before kickoff (the server
 * enforces; the UI shows the window).
 *
 * The club selector is presentation only. The payload stays `{ playerIds,
 * formation }`, which the resolver scores side-agnostically — a pick doesn't
 * carry a side (prediction-mechanics.md §1).
 */
export function LineupPicker({
  matchId,
  initial,
  onSubmit,
  submitting,
}: {
  matchId: string;
  initial: unknown;
  onSubmit: (payload: { playerIds: string[]; formation: string }) => void;
  submitting: boolean;
}) {
  const { t, localize } = useI18n();
  const matchQuery = useMatch(matchId);

  // ESPN's recorded shapes, once published — they prefill the picker instead of
  // making the user retype a shape the app already knows.
  const officialQuery = useQuery({
    queryKey: ["lineups", matchId],
    queryFn: () => api.getLineups(matchId),
    staleTime: 5 * 60_000,
  });

  const init = (initial ?? null) as { playerIds?: string[]; formation?: string } | null;
  const [side, setSide] = useState<Side>("home");
  const [picked, setPicked] = useState<string[]>(init?.playerIds ?? []);
  const [formation, setFormation] = useState<string>(init?.formation ?? FORMATIONS[0].id);
  const [touchedFormation, setTouchedFormation] = useState(Boolean(init?.formation));

  const match = matchQuery.data;
  const team = side === "home" ? match?.home : match?.away;
  const squadQuery = useSquad(team?.id ?? "");
  const players = useMemo(() => squadQuery.data?.players ?? [], [squadQuery.data]);

  const positions = useMemo(() => {
    const map = new Map<string, Unit>();
    for (const p of players) map.set(p.id, (p.position ?? "MID") as Unit);
    return map;
  }, [players]);

  const tally = useMemo(() => unitTally(picked, positions, formation), [picked, positions, formation]);
  const required = requiredUnits(formation);
  const complete = isValidXI(picked, positions);
  const shapeMatches = tally.every((t) => t.picked === t.required);

  // Follow the club's own shape until the user picks one themselves.
  useEffect(() => {
    if (touchedFormation) return;
    const official =
      side === "home" ? officialQuery.data?.home.formation : officialQuery.data?.away.formation;
    if (official && isValidFormationId(official)) setFormation(official);
  }, [side, officialQuery.data, touchedFormation]);

  // Switching club must not carry the other club's players into the XI.
  useEffect(() => {
    setPicked((prev) => prev.filter((id) => positions.has(id)));
  }, [positions]);

  const toggle = (playerId: string) => {
    selectionHaptic();
    setPicked((prev) =>
      prev.includes(playerId)
        ? prev.filter((id) => id !== playerId)
        : prev.length < XI_SIZE
          ? [...prev, playerId]
          : prev,
    );
  };

  if (matchQuery.isLoading) return <PanelSkeleton height={220} />;
  if (matchQuery.isError) return <ErrorState onRetry={() => matchQuery.refetch()} />;
  if (!match) return <EmptyState title={t("lineup.squadEmpty")} hint={t("lineup.squadEmptyHint")} />;

  return (
    <div className="space-y-3">
      {/* Which club's XI is being predicted. */}
      <div>
        <p className="label mb-1.5 text-ink-2">{t("lineup.pickClub")}</p>
        <div className="grid grid-cols-2 gap-2">
          {(["home", "away"] as Side[]).map((option) => {
            const club = option === "home" ? match.home : match.away;
            const active = side === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  selectionHaptic();
                  setSide(option);
                }}
                aria-pressed={active}
                className={cx(
                  "flex min-h-11 items-center gap-2 rounded-card border px-2.5 text-start transition-colors duration-[var(--t-fast)]",
                  active ? "border-volt bg-elevated" : "border-line bg-surface hover:bg-elevated",
                )}
              >
                <TeamBadge team={club} size="sm" />
                <span className="min-w-0 flex-1 truncate text-xs font-bold text-ink">
                  {localize(club.shortName)}
                </span>
                {active ? <CheckIcon className="h-4 w-4 flex-none text-volt" /> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Chip tone={complete ? "pitch" : "volt"}>
          <Num>{picked.length}</Num>/{XI_SIZE}
        </Chip>
        <span className="text-[11px] text-ink-3">
          {t("lineup.perStarter")} · {t("lineup.exactFormation")}
        </span>
      </div>

      <div>
        <p className="label mb-1.5 text-ink-2">{t("lineup.shape")}</p>
        <LineupPitch formationId={formation} squad={players} picked={picked} />
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {FORMATIONS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                haptic("light");
                setTouchedFormation(true);
                if (isValidFormationId(f.id)) setFormation(f.id);
              }}
              aria-pressed={formation === f.id}
              className={cx(
                "min-h-11 rounded-md border text-xs font-bold transition-colors duration-[var(--t-fast)]",
                formation === f.id
                  ? "border-volt bg-elevated text-volt"
                  : "border-line bg-surface text-ink-2",
              )}
            >
              {f.id}
            </button>
          ))}
        </div>
      </div>

      {/* The club's full squad, grouped by unit so the shape maps onto the list. */}
      <div>
        <p className="label mb-1.5 text-ink-2">{t("lineup.squad")}</p>
        {squadQuery.isLoading ? (
          <PanelSkeleton height={140} />
        ) : squadQuery.isError ? (
          <ErrorState onRetry={() => squadQuery.refetch()} />
        ) : players.length === 0 ? (
          <EmptyState title={t("lineup.squadEmpty")} hint={t("lineup.squadEmptyHint")} />
        ) : (
          <ul className="max-h-[38vh] space-y-2 overflow-y-auto pe-0.5">
            {UNITS.map((unit) => {
              // Ordered the way the pitch reads: left-back, centre-backs,
              // right-back — not by shirt number.
              const group = players.filter((p) => p.position === unit);
              group.sort((a, b) => compareSquad(asCandidate(a), asCandidate(b)));
              if (group.length === 0) return null;
              const count = tally.find((entry) => entry.unit === unit);
              const done = count ? count.picked === count.required : false;
              return (
                <li key={unit}>
                  <div className="sticky top-0 z-10 flex items-center justify-between bg-surface/95 py-1 backdrop-blur-sm">
                    <span className="label text-ink-2">{t(`lineup.unit.${unit}`)}</span>
                    <span
                      className={cx("text-[10px] font-bold tabular-nums", done ? "text-volt" : "text-ink-3")}
                    >
                      {count?.picked ?? 0}/{required[unit]}
                    </span>
                  </div>
                  <ul className="mt-1 space-y-1.5">
                    {group.map((player) => (
                      <PlayerRow
                        key={player.id}
                        player={player}
                        picked={picked.includes(player.id)}
                        onToggle={() => toggle(player.id)}
                      />
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {picked.length === XI_SIZE && !shapeMatches ? (
        <p className="text-[11px] font-bold text-gold">{t("lineup.shapeMismatch")}</p>
      ) : null}

      <div className="flex gap-2">
        <Button
          variant="ghost"
          className="flex-none"
          onClick={() => {
            haptic("light");
            setPicked([]);
          }}
          disabled={picked.length === 0 || submitting}
        >
          {t("lineup.reset")}
        </Button>
        <Button
          className="flex-1"
          disabled={!complete || submitting}
          onClick={() => onSubmit({ playerIds: picked, formation })}
        >
          {submitting ? t("common.loading") : t("lineup.confirm")}
        </Button>
      </div>
    </div>
  );
}
