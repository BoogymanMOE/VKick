import { useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseMutateFunction } from "@tanstack/react-query";
import { api, serverErrorKey, type ApiPrediction } from "../../lib/api";
import { useI18n } from "../../i18n/I18nProvider";
import { haptic, notifyHaptic, selectionHaptic } from "../../lib/telegram";
import { useLocalState } from "../../lib/useLocalState";
import { useToast } from "../Toast";
import { BottomSheet } from "../BottomSheet";
import { PredictionsHubSkeleton, PanelSkeleton } from "../Skeletons";
import { Button, Card, Chip, EmptyState, ErrorState, Num, cx } from "../ui";
import { SubBoard } from "./SubBoard";
import { LineupPicker } from "./LineupPicker";
import { ShotPredictor } from "./ShotPredictor";
import { StarFilledIcon, SwapIcon, TargetIcon } from "../icons";

type Mechanic = ApiPrediction["mechanic"];
type PredictionsData = Awaited<ReturnType<typeof api.getMyPredictions>>;
type SubmitResult = Awaited<ReturnType<typeof api.submitPrediction>>;

// Abbreviations stay text (they are labels); pictographic mechanics get the
// shared icon set so they don't shift weight with the system font.
const MECHANIC_META: Record<
  Mechanic,
  {
    key: string;
    hintKey: string;
    lockKey: string;
    text?: string;
    Glyph?: typeof StarFilledIcon;
    tone: "volt" | "live" | "gold";
  }
> = {
  lineup: {
    key: "predict.lineup",
    hintKey: "predict.lineupHint",
    lockKey: "predict.lockLineup",
    text: "XI",
    tone: "volt",
  },
  sub: {
    key: "predict.sub",
    hintKey: "predict.subNewHint",
    lockKey: "predict.lockHT",
    Glyph: SwapIcon,
    tone: "live",
  },
  shot_predict: {
    key: "predict.shotNew",
    hintKey: "predict.shotNewHint",
    lockKey: "predict.lockKickoff",
    Glyph: TargetIcon,
    tone: "volt",
  },
  player_watch: {
    key: "predict.watch",
    hintKey: "predict.watchHintNew",
    lockKey: "predict.lockKickoff",
    Glyph: StarFilledIcon,
    tone: "gold",
  },
  versus: {
    key: "predict.versus",
    hintKey: "predict.versusNewHint",
    lockKey: "predict.lockKickoff",
    text: "VS",
    tone: "volt",
  },
};

/**
 * The stakes layer on each match: all five mechanics, each with its own open
 * window and lock time (prediction-mechanics.md). Points resolve into the
 * season leaderboards; nothing here touches ratings.
 */
export function PredictionsHub({ matchId }: { matchId: string }) {
  const { t } = useI18n();
  const { push } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["predictions", matchId],
    queryFn: () => api.getMyPredictions(matchId),
  });
  const rows = query.data?.predictions ?? [];
  const windows = query.data?.windows ?? {};
  const matchStatus = query.data?.matchStatus ?? "scheduled";
  const live = matchStatus === "live";
  const halftime = matchStatus === "halftime";
  const finished = matchStatus === "finished";

  const [editor, setEditor] = useState<Mechanic | null>(null);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["predictions", matchId] });

  /*
   * Optimistic upsert: the editor sheet closes and the card shows the saved
   * pick instantly — the server round-trip lands in the background. Rollback
   * restores the previous list if the submit fails (lock windows, caps…).
   */
  const optimisticUpsert = useMutation({
    mutationFn: (vars: { mechanic: Mechanic; payload: unknown }) =>
      api.submitPrediction(matchId, vars.mechanic, vars.payload),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ["predictions", matchId] });
      const prev = queryClient.getQueryData<PredictionsData>(["predictions", matchId]);
      if (prev) {
        const optimisticRow: ApiPrediction = {
          id: -Date.now(),
          match_id: matchId,
          mechanic: vars.mechanic,
          payload: JSON.stringify(vars.payload),
          locked_at: new Date().toISOString(),
          status: "pending",
          points_awarded: 0,
          breakdown: null,
          resolved_at: null,
        };
        const rest = prev.predictions.filter((r) => r.mechanic !== vars.mechanic);
        queryClient.setQueryData<PredictionsData>(["predictions", matchId], {
          ...prev,
          predictions: [...rest, optimisticRow],
        });
      }
      return { prev, mechanic: vars.mechanic };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["predictions", matchId], ctx.prev);
    },
  });

  const byMechanic = (m: Mechanic) => rows.find((r) => r.mechanic === m) ?? null;

  const statusChip = (row: ApiPrediction | null) => {
    if (!row) return null;
    if (row.status === "pending") return <Chip tone="muted">{t("predict.pending")}</Chip>;
    if (row.status === "correct") return <Chip tone="pitch">+{row.points_awarded}</Chip>;
    if (row.status === "partial") return <Chip tone="gold">+{row.points_awarded}</Chip>;
    if (row.status === "void") return <Chip tone="muted">±0</Chip>;
    return <Chip tone="danger">+0</Chip>;
  };

  const windowInfo = (m: Mechanic) => {
    const w = windows[m];
    if (!w) return null;
    if (finished) return t("predict.locked");
    if (halftime) {
      // The break IS the sub lock: only the sub mechanic's copy changes.
      return m === "sub" ? t("sub.lockedHalftime") : t("predict.locked");
    }
    if (live) {
      return m === "sub" ? t("predict.lockHT") : t("predict.locked");
    }
    const lockMs = new Date(w.lockAt).getTime() - Date.now();
    if (lockMs <= 0) return t("predict.locked");
    const hours = Math.floor(lockMs / 3_600_000);
    const minutes = Math.floor((lockMs % 3_600_000) / 60_000);
    return `${hours}h ${minutes}m`;
  };

  const mechanics: Mechanic[] = ["lineup", "sub", "shot_predict", "player_watch", "versus"];

  /* --- Progressive disclosure ------------------------------------------------
     The full 5-mechanic board is a lot before a user's first real match. The
     count of distinct matchdays the user has ever predicted on (persisted in
     localStorage) opens the set up in tiers; any mechanic with an existing
     pick and any mechanic whose window is open right now always shows. */
  // Distinct days on which the user has ever submitted a prediction — a
  // lightweight, local proxy for "returned and played real matchdays".
  const [daysPlayed, setDaysPlayed] = useLocalState<string[]>("verdikick.matchdaysPredicted", []);
  const matchdaysPlayed = daysPlayed.length;
  const tier = matchdaysPlayed >= 2 ? 2 : matchdaysPlayed; // 0 | 1 | 2+
  const recordMatchday = () => {
    const today = new Date().toISOString().slice(0, 10);
    setDaysPlayed((prev) => (prev.includes(today) ? prev : [...prev.slice(-49), today]));
  };
  const alwaysVisible = new Set<Mechanic>(["lineup"]);
  for (const m of mechanics) {
    if (byMechanic(m)) alwaysVisible.add(m);
    const w = windows[m];
    const opensAt = w?.opensAt ? new Date(w.opensAt).getTime() : null;
    const windowOpen =
      opensAt !== null && Date.now() >= opensAt && new Date(w?.lockAt ?? 0).getTime() > Date.now();
    if (windowOpen) alwaysVisible.add(m);
    if (live || halftime) alwaysVisible.add("sub");
  }
  const visible = mechanics.filter((m) => alwaysVisible.has(m) || mechanics.indexOf(m) < 1 + tier * 2);
  const hiddenCount = mechanics.length - visible.length;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-ink-3">{t("predict.hubHint")}</p>
      {halftime ? (
        <Card className="border-live/40 p-2.5">
          <span className="text-[11px] font-bold text-live">{t("sub.halftimeBanner")}</span>
        </Card>
      ) : null}

      {query.isLoading ? (
        <PredictionsHubSkeleton />
      ) : (
        visible.map((m) => {
          const meta = MECHANIC_META[m];
          const row = byMechanic(m);
          const w = windows[m];
          const opensAt = w?.opensAt ? new Date(w.opensAt).getTime() : null;
          const notOpenYet = opensAt !== null && Date.now() < opensAt && !live && !finished;
          return (
            <Card key={m} className={cx("p-3", row && "border-volt/40")}>
              <div className="flex items-center gap-2">
                <span
                  className={cx(
                    "grid h-8 min-w-8 place-items-center rounded-full border px-1 text-[10px] font-extrabold",
                    meta.tone === "gold"
                      ? "border-gold text-gold"
                      : meta.tone === "live"
                        ? "border-live text-live"
                        : "border-volt text-volt",
                  )}
                  aria-hidden="true"
                >
                  {meta.Glyph ? <meta.Glyph className="h-4 w-4" /> : meta.text}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-ink">{t(meta.key as never)}</span>
                  <span className="block truncate text-[11px] text-ink-3">{t(meta.hintKey as never)}</span>
                </span>
                {statusChip(row)}
              </div>

              <div className="mt-2 flex items-center justify-between gap-2">
                <span className="label text-ink-3">
                  {m === "sub"
                    ? t("predict.lockHT")
                    : `${t(meta.lockKey as never)}${!notOpenYet && !live && !finished ? ` · ${windowInfo(m) ?? ""}` : ""}`}
                </span>
                {row?.payload ? <MechanicSummary mechanic={m} payload={row.payload} /> : null}
                {!finished && !halftime ? (
                  <Button
                    variant={row ? "ghost" : "primary"}
                    className="min-h-9 px-3 text-xs"
                    disabled={notOpenYet}
                    onClick={() => {
                      haptic("light");
                      setEditor(m);
                    }}
                  >
                    {row ? t("versus.change") : t("match.predict")}
                  </Button>
                ) : null}
              </div>
            </Card>
          );
        })
      )}

      {!query.isLoading && hiddenCount > 0 ? (
        <div className="rounded-card border border-dashed border-line p-3">
          <p className="text-sm font-bold text-ink-2">{t("predict.teaserTitle", { count: hiddenCount })}</p>
          <p className="mt-0.5 text-[11px] text-ink-3">{t("predict.teaserHint")}</p>
        </div>
      ) : null}

      {editor ? (
        <MechanicEditor
          mechanic={editor}
          matchId={matchId}
          live={live}
          existing={byMechanic(editor)}
          onClose={() => setEditor(null)}
          onSaved={() => {
            recordMatchday();
            // Invalidate (don't await): the optimistic row already shows; the
            // refetch replaces it with server truth (lock windows, ids).
            invalidate();
            setEditor(null);
          }}
          onError={(err) => {
            notifyHaptic("error");
            push({ text: t(serverErrorKey(err) as never), tone: "danger", icon: "✕" });
          }}
          optimisticUpsert={optimisticUpsert.mutate}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ editors */

function MechanicEditor({
  mechanic,
  matchId,
  live,
  existing,
  onClose,
  onSaved,
  onError,
  optimisticUpsert,
}: {
  mechanic: Mechanic;
  matchId: string;
  live: boolean;
  existing: ApiPrediction | null;
  onClose: () => void;
  onSaved: () => void;
  onError: (err: unknown) => void;
  optimisticUpsert: UseMutateFunction<SubmitResult, Error, { mechanic: Mechanic; payload: unknown }>;
}) {
  const { t } = useI18n();
  const submit = useMutation({
    mutationFn: (payload: unknown) => {
      // Optimistic path: cache updates immediately; the sheet closes on settle.
      optimisticUpsert({ mechanic, payload });
      return api.submitPrediction(matchId, mechanic, payload);
    },
    onSuccess: () => {
      notifyHaptic("success");
      onSaved();
    },
    onError,
  });

  if (mechanic === "lineup") {
    return (
      <BottomSheet
        open
        onClose={onClose}
        title={t("predict.lineup" as never)}
        subtitle={t("predict.lockLineup" as never)}
      >
        <LineupPicker
          matchId={matchId}
          initial={existing ? safeParse(existing.payload) : null}
          onSubmit={(payload) => submit.mutate(payload)}
          submitting={submit.isPending}
        />
      </BottomSheet>
    );
  }

  if (mechanic === "sub") {
    return (
      <BottomSheet
        open
        onClose={onClose}
        title={t("sub.boardTitle" as never)}
        subtitle={t("predict.lockHT" as never)}
      >
        <SubBoard
          matchId={matchId}
          live={live}
          initial={existing ? safeParse(existing.payload) : null}
          onSubmit={(payload) => submit.mutate(payload)}
          submitting={submit.isPending}
        />
      </BottomSheet>
    );
  }

  if (mechanic === "shot_predict") {
    return (
      <BottomSheet
        open
        onClose={onClose}
        title={t("predict.shotNew" as never)}
        subtitle={t("predict.shotNewHint" as never)}
      >
        <ShotPredictor
          matchId={matchId}
          initial={existing ? safeParse(existing.payload) : null}
          onSubmit={(payload) => submit.mutate(payload)}
          submitting={submit.isPending}
        />
      </BottomSheet>
    );
  }

  if (mechanic === "player_watch") {
    return (
      <BottomSheet
        open
        onClose={onClose}
        title={t("predict.watch" as never)}
        subtitle={t("predict.watchHintNew" as never)}
      >
        <WatchEditor
          matchId={matchId}
          initial={existing ? safeParse(existing.payload) : null}
          onSubmit={(payload) => submit.mutate(payload)}
          submitting={submit.isPending}
        />
      </BottomSheet>
    );
  }

  return (
    <BottomSheet
      open
      onClose={onClose}
      title={t("versus.title" as never)}
      subtitle={t("predict.versusNewHint" as never)}
    >
      <VersusEditor
        matchId={matchId}
        initial={existing ? safeParse(existing.payload) : null}
        onSubmit={(payload) => submit.mutate(payload)}
        submitting={submit.isPending}
      />
    </BottomSheet>
  );
}

/* ------------------------------------------------------------ watch editor */

function WatchEditor({
  matchId,
  initial,
  onSubmit,
  submitting,
}: {
  matchId: string;
  initial: unknown;
  onSubmit: (payload: { playerId: string }) => void;
  submitting: boolean;
}) {
  const { t, localize } = useI18n();
  const query = useQuery({
    queryKey: ["lineups", matchId],
    queryFn: () => api.getLineups(matchId),
  });
  const players = query.data?.players ?? [];
  const featured = players.filter((p) => p.started === 1 || (p.minutes_played ?? 0) > 0);
  const [pick, setPick] = useState<string | null>(
    initial && typeof initial === "object" && "playerId" in (initial as Record<string, unknown>)
      ? String((initial as Record<string, unknown>).playerId)
      : null,
  );

  if (query.isLoading) return <PanelSkeleton height={160} />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  if (featured.length === 0) {
    return (
      <div className="py-4">
        <EmptyState title={t("lineups.loadingHint")} hint={t("lineups.emptyHint")} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="max-h-[50vh] space-y-1.5 overflow-y-auto">
        {featured.map((p) => (
          <li key={p.player_id}>
            <button
              type="button"
              onClick={() => {
                selectionHaptic();
                setPick(p.player_id);
              }}
              className={cx(
                "flex w-full items-center gap-3 rounded-card border p-2.5 text-start transition-colors duration-[var(--t-fast)]",
                pick === p.player_id ? "border-gold bg-elevated" : "border-line bg-surface hover:bg-elevated",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                {localize(p.full_name)}
              </span>
              <Chip tone="muted" normalCase>
                {p.position}
              </Chip>
              {pick === p.player_id ? <Chip tone="gold">{t("watch.selected")}</Chip> : null}
            </button>
          </li>
        ))}
      </ul>
      <Button
        className="w-full"
        disabled={!pick || submitting}
        onClick={() => pick && onSubmit({ playerId: pick })}
      >
        {submitting ? t("common.loading") : t("common.save")}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------ versus editor */

function VersusEditor({
  matchId,
  initial,
  onSubmit,
  submitting,
}: {
  matchId: string;
  initial: unknown;
  onSubmit: (payload: { playerAId: string; playerBId: string }) => void;
  submitting: boolean;
}) {
  const { t, localize } = useI18n();
  const query = useQuery({
    queryKey: ["lineups", matchId],
    queryFn: () => api.getLineups(matchId),
  });
  const players = query.data?.players ?? [];
  const [sideA, setSideA] = useState<string | null>(
    initial && typeof initial === "object" && "playerAId" in (initial as Record<string, unknown>)
      ? String((initial as Record<string, unknown>).playerAId)
      : null,
  );
  const [sideB, setSideB] = useState<string | null>(
    initial && typeof initial === "object" && "playerBId" in (initial as Record<string, unknown>)
      ? String((initial as Record<string, unknown>).playerBId)
      : null,
  );

  if (query.isLoading) return <PanelSkeleton height={160} />;
  if (query.isError) return <ErrorState onRetry={() => query.refetch()} />;
  const featured = players.filter((p) => p.started === 1 || (p.minutes_played ?? 0) > 0);
  const teams = [...new Set(featured.map((p) => p.team_id))];

  if (featured.length === 0 || teams.length < 2) {
    return (
      <div className="py-4">
        <EmptyState title={t("lineups.loadingHint")} hint={t("lineups.emptyHint")} />
      </div>
    );
  }

  const groupA = featured.filter((p) => p.team_id === teams[0]);
  const groupB = featured.filter((p) => p.team_id === teams[1]);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-ink-3">{t("predict.versusNewHint")}</p>
      {teams.map((teamId, index) => (
        <div key={teamId}>
          <p className="mb-1.5 label text-ink-2">{index === 0 ? "A" : "B"}</p>
          <ul className="max-h-44 space-y-1.5 overflow-y-auto">
            {(index === 0 ? groupA : groupB).map((p) => (
              <li key={p.player_id}>
                <button
                  type="button"
                  onClick={() => {
                    selectionHaptic();
                    if (index === 0) setSideA(p.player_id);
                    else setSideB(p.player_id);
                  }}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-card border p-2.5 text-start transition-colors duration-[var(--t-fast)]",
                    (index === 0 ? sideA : sideB) === p.player_id
                      ? "border-volt bg-elevated"
                      : "border-line bg-surface hover:bg-elevated",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                    {localize(p.full_name)}
                  </span>
                  {(index === 0 ? sideA : sideB) === p.player_id ? (
                    <Chip tone="volt">{t("watch.selected")}</Chip>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <Button
        className="w-full"
        disabled={!sideA || !sideB || submitting}
        onClick={() => sideA && sideB && onSubmit({ playerAId: sideA, playerBId: sideB })}
      >
        {submitting ? t("common.loading") : t("common.save")}
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------ shared */

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function MechanicSummary({ mechanic, payload }: { mechanic: Mechanic; payload: string }) {
  const parsed = safeParse(payload) as Record<string, unknown> | null;
  if (!parsed) return null;

  if (mechanic === "player_watch" || mechanic === "shot_predict") {
    const pid = String(parsed.playerId ?? "");
    return pid ? <Num className="text-[10px] text-ink-3">#{pid}</Num> : null;
  }
  if (mechanic === "versus") {
    const a = String(parsed.playerAId ?? "");
    const b = String(parsed.playerBId ?? "");
    return (
      <Num className="text-[10px] text-ink-3">
        #{a} v #{b}
      </Num>
    );
  }
  if (mechanic === "sub") {
    const subs = Array.isArray(parsed.subs) ? parsed.subs.length : 0;
    return <Num className="text-[10px] text-ink-3">{subs}</Num>;
  }
  if (mechanic === "lineup") {
    const ids = Array.isArray(parsed.playerIds) ? parsed.playerIds.length : 0;
    return (
      <Num className="text-[10px] text-ink-3">
        {ids} · {String(parsed.formation ?? "")}
      </Num>
    );
  }
  return null;
}
