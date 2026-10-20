import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useI18n } from "../../i18n/context";
import { selectionHaptic } from "../../lib/telegram";
import { Button, Chip, EmptyState, ErrorState } from "../ui";
import { PanelSkeleton } from "../Skeletons";
import { cellZone, GRID_COLS, GRID_ROWS, ZONE_LABEL_KEY } from "../../lib/zones";

/** The 6 scoring zones in legend order (scoring-rules.md §3). */
const ZONE_KEYS = Object.values(ZONE_LABEL_KEY);

/**
 * Shot Predictor editor: ONE player, ONE of the 6 scoring zones (left/
 * center/right × inside/outside box), rendered as a 6×4 grid whose cells
 * map to zones — geometry mirrored from server/scoring/shotZones.ts
 * (scoring-rules.md: exact 5 / adjacent 2, +2 on target, +5 goal).
 */
export function ShotPredictor({
  matchId,
  initial,
  onSubmit,
  submitting,
}: {
  matchId: string;
  initial: unknown;
  onSubmit: (payload: { playerId: string; grid: { gridX: number; gridY: number } }) => void;
  submitting: boolean;
}) {
  const { t, localize } = useI18n();
  const lineupsQuery = useQuery({
    queryKey: ["lineups", matchId],
    queryFn: () => api.getLineups(matchId),
  });

  const init = (initial ?? null) as { playerId?: string; grid?: { gridX: number; gridY: number } } | null;
  const [playerId, setPlayerId] = useState<string | null>(init?.playerId ?? null);
  const [cell, setCell] = useState<{ gridX: number; gridY: number } | null>(init?.grid ?? null);

  const players = lineupsQuery.data?.players ?? [];
  const featured = players.filter((p) => p.started === 1 || (p.minutes_played ?? 0) > 0);

  if (lineupsQuery.isLoading) return <PanelSkeleton height={160} />;
  if (lineupsQuery.isError) return <ErrorState onRetry={() => lineupsQuery.refetch()} />;
  if (featured.length === 0) {
    return <EmptyState title={t("predict.awaitLineupTitle")} hint={t("predict.awaitLineupHint")} />;
  }

  const cells = Array.from({ length: GRID_ROWS * GRID_COLS }, (_, i) => ({
    gridX: i % GRID_COLS,
    gridY: Math.floor(i / GRID_COLS),
  }));

  return (
    <div className="space-y-3">
      {/* Player */}
      <label className="block">
        <span className="mb-1 block label text-ink-3">{t("watch.pick")}</span>
        <select
          value={playerId ?? ""}
          onChange={(e) => setPlayerId(e.target.value)}
          className="min-h-11 w-full rounded-card border border-line bg-elevated px-3 text-sm font-bold text-ink"
        >
          <option value="">—</option>
          {featured.map((p) => (
            <option key={p.player_id} value={p.player_id}>
              {localize(p.full_name)}
            </option>
          ))}
        </select>
      </label>

      {/* Grid: attacking end at the top, matches the server's row-0 convention.
          It is drawn on a turf plate with white markings — goal line, penalty
          area, six-yard box, halfway line — so a cell reads as a place on the
          pitch rather than a keypad key. */}
      <div dir="ltr">
        <p className="mb-1 text-center label text-ink-3">↑ {t("shot.attackingEnd")}</p>
        <div className="relative overflow-hidden rounded-card border border-line bg-pitch/20 p-2">
          <div
            className="relative grid gap-0.5"
            style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)` }}
            role="grid"
            aria-label={t("shot.cellLabel", { row: 1, col: 1 })}
          >
            {cells.map(({ gridX, gridY }) => {
              const pressed = cell?.gridX === gridX && cell?.gridY === gridY;
              return (
                <button
                  key={`${gridX}-${gridY}`}
                  type="button"
                  role="gridcell"
                  aria-pressed={pressed}
                  aria-label={`row ${gridY + 1}, column ${gridX + 1}`}
                  onClick={() => {
                    selectionHaptic();
                    setCell({ gridX, gridY });
                  }}
                  className="plot-cell relative aspect-[4/3] rounded-[4px]"
                >
                  {pressed ? (
                    <>
                      {/* Signature animation 4: pin drop with overshoot + ripple ring. */}
                      <span
                        key={`${gridX}-${gridY}`}
                        className="pin-drop absolute inset-0 grid place-items-center"
                        aria-hidden="true"
                      >
                        <span className="block h-2.5 w-2.5 rounded-full bg-volt" />
                      </span>
                      <span
                        className="pin-ripple pointer-events-none absolute inset-0 rounded-[4px] border border-volt"
                        aria-hidden="true"
                      />
                    </>
                  ) : null}
                </button>
              );
            })}
          </div>

          {/* Markings, painted over the cells. Geometry mirrors the server's
              field coords: the box starts 18% along the length and spans the
              middle 57% of the width (shotZones.ts). Decorative and
              pointer-transparent, so every cell stays tappable. */}
          <div className="pointer-events-none absolute inset-2" aria-hidden="true">
            <span className="absolute inset-x-0 top-0 h-px bg-white/40" />
            <span className="absolute top-0 left-1/2 h-[6%] w-[24%] -translate-x-1/2 border-x border-b border-white/30 bg-white/10" />
            <span className="absolute top-0 left-1/2 h-[18%] w-[57%] -translate-x-1/2 border-x border-b border-white/25" />
            <span className="absolute top-0 left-1/2 h-[7%] w-[28%] -translate-x-1/2 border-x border-b border-white/20" />
            <span className="absolute top-[13%] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/50" />
            <span className="absolute inset-x-0 top-1/2 h-px bg-white/15" />
            <span className="absolute top-1/2 left-1/2 aspect-square h-[24%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
        {ZONE_KEYS.map((key) => (
          <span key={key} className="text-xs text-ink-3">
            {t(key as never)}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-ink-3">{t("predict.shotNewHint")}</span>
        {cell ? (
          <Chip tone="volt">{t(ZONE_LABEL_KEY[cellZone(cell.gridX, cell.gridY)] as never)}</Chip>
        ) : null}
      </div>

      <Button
        className="w-full"
        disabled={!playerId || !cell || submitting}
        onClick={() => playerId && cell && onSubmit({ playerId, grid: cell })}
      >
        {submitting ? t("common.loading") : t("common.save")}
      </Button>
    </div>
  );
}
