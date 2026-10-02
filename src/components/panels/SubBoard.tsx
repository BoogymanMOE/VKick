import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useI18n } from "../../i18n/I18nProvider";
import { haptic, selectionHaptic } from "../../lib/telegram";
import { Button, Chip, EmptyState, ErrorState, Num, cx } from "../ui";
import { PanelSkeleton } from "../Skeletons";

/**
 * Sub Predictor editor — the whole expected sub board in one submission
 * (concept v2): each row is one predicted pair (off -> on), editable until
 * half-time. Scoring: +1 correct off, +1 more for the correct replacement.
 */
export function SubBoard({
  matchId,
  live,
  initial,
  onSubmit,
  submitting,
}: {
  matchId: string;
  live: boolean;
  initial: unknown;
  onSubmit: (payload: { subs: Array<{ offId: string; onId: string }> }) => void;
  submitting: boolean;
}) {
  const { t, localize } = useI18n();
  const query = useQuery({
    queryKey: ["lineups", matchId],
    queryFn: () => api.getLineups(matchId),
  });

  const init = (initial ?? null) as { subs?: Array<{ offId: string; onId: string }> } | null;
  const [pairs, setPairs] = useState<Array<{ offId: string; onId: string }>>(init?.subs ?? []);
  const [draft, setDraft] = useState<{ offId: string | null; onId: string | null }>({
    offId: null,
    onId: null,
  });

  if (query.isLoading) return <PanelSkeleton height={160} />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;

  const players = query.data?.players ?? [];
  const starters = players.filter((p) => p.started === 1);
  const bench = players.filter((p) => p.started !== 1);
  const legal = players; // both directions draw from the full squad list

  if (players.length === 0) {
    return (
      <div className="py-4">
        <EmptyState title={t("lineups.loadingHint")} hint={t("lineups.emptyHint")} />
      </div>
    );
  }

  const draftComplete = draft.offId && draft.onId && draft.offId !== draft.onId;
  const addPair = () => {
    if (!draft.offId || !draft.onId || draft.offId === draft.onId) return;
    if (pairs.length >= 5 || pairs.some((p) => p.offId === draft.offId)) return;
    selectionHaptic();
    setPairs((prev) => [...prev, { offId: draft.offId!, onId: draft.onId! }]);
    setDraft({ offId: null, onId: null });
  };

  const nameOf = (playerId: string) => {
    const p = legal.find((row) => row.player_id === playerId);
    return p ? localize(p.full_name) : `#${playerId}`;
  };

  return (
    <div className="space-y-3">
      {live ? <Chip tone="live">{t("sub.windowLive")}</Chip> : null}

      {/* Current board */}
      <div>
        <p className="mb-1.5 label text-ink-2">{t("sub.boardTitle")}</p>
        {pairs.length === 0 ? (
          <p className="rounded-card border border-dashed border-line px-3 py-3 text-center text-xs text-ink-3">
            {t("sub.emptyBoard")}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {pairs.map((pair) => (
              <li
                key={pair.offId}
                className="flex items-center gap-2 rounded-card border border-line bg-surface p-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-xs font-bold text-ink">
                  {nameOf(pair.offId)}
                </span>
                <span className="flex-none text-[11px] text-ink-3">→</span>
                <span className="min-w-0 flex-1 truncate text-xs font-bold text-volt">
                  {nameOf(pair.onId)}
                </span>
                <button
                  type="button"
                  aria-label={t("sub.removePair")}
                  onClick={() => setPairs((prev) => prev.filter((p) => p.offId !== pair.offId))}
                  className="flex-none text-ink-3 transition-colors hover:text-danger"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Draft a pair */}
      <div className="rounded-card border border-line p-3">
        <PlayerSelect
          label={t("sub.pairOff")}
          players={starters.length > 0 ? starters : legal}
          value={draft.offId}
          onChange={(id) => setDraft((d) => ({ ...d, offId: id }))}
        />
        <div className="mt-2">
          <PlayerSelect
            label={t("sub.pairOn")}
            players={bench.length > 0 ? bench : legal}
            value={draft.onId}
            onChange={(id) => setDraft((d) => ({ ...d, onId: id }))}
          />
        </div>
        <Button
          variant="ghost"
          className="mt-3 w-full text-xs"
          disabled={!draftComplete || pairs.length >= 5}
          onClick={addPair}
        >
          + {t("sub.addPair")}
        </Button>
      </div>

      <Button
        className="w-full"
        disabled={pairs.length === 0 || submitting}
        onClick={() => onSubmit({ subs: pairs })}
      >
        {submitting ? t("common.loading") : t("sub.saveBoard")}
      </Button>
    </div>
  );
}

function PlayerSelect({
  label,
  players,
  value,
  onChange,
}: {
  label: string;
  players: Array<{ player_id: string; full_name: string; jersey_number: number | null }>;
  value: string | null;
  onChange: (id: string) => void;
}) {
  const { t, localize } = useI18n();
  return (
    <label className="block">
      <span className="mb-1 block label text-ink-3">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => {
          haptic("light");
          onChange(e.target.value);
        }}
        className={cx(
          "min-h-11 w-full rounded-card border border-line bg-elevated px-3 text-sm font-bold text-ink",
          "focus-visible:outline-2 focus-visible:outline-volt",
        )}
      >
        <option value="">—</option>
        {players.map((p) => (
          <option key={p.player_id} value={p.player_id}>
            {p.jersey_number ? <Num>{p.jersey_number}</Num> : null} {localize(p.full_name)}
          </option>
        ))}
      </select>
      <span className="sr-only">{t("sub.pickOff")}</span>
    </label>
  );
}
