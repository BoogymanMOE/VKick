import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useI18n } from "../../i18n/I18nProvider";
import { selectionHaptic } from "../../lib/telegram";
import { Button, Chip, EmptyState, ErrorState, cx } from "../ui";
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
    return <EmptyState title={t("lineups.loadingHint")} hint={t("lineups.emptyHint")} />;
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

      {/* Grid: attacking end at the top, matches the server's row-0 convention */}
      <div dir="ltr">
        <p className="mb-1 text-center label text-ink-3">↑ {t("shot.attackingEnd")}</p>
        <div
          className="grid gap-0.5"
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
                className={cx(
                  "plot-cell relative aspect-[4/3] rounded-[4px]",
                  pressed && "aria-pressed:true",
                )}
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
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5">
        {ZONE_KEYS.map((key) => (
          <span key={key} className="text-[9px] text-ink-3">
            {t(key as never)}
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[11px] text-ink-3">{t("predict.shotNewHint")}</span>
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
