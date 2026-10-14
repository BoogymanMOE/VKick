import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseMutateFunction } from "@tanstack/react-query";
import { api, serverErrorKey, type ApiPrediction } from "../../lib/api";
import { useI18n } from "../../i18n/context";
import { haptic, notifyHaptic, selectionHaptic } from "../../lib/telegram";
import { pickSummary } from "../../lib/breakdown";
import { useToast } from "../toastContext";
import { BottomSheet } from "../BottomSheet";
import { RulesButton } from "../RulesSheet";
import { PredictionsHubSkeleton, PanelSkeleton } from "../Skeletons";
import { cx } from "../../lib/cx";
import { Button, Card, Chip, EmptyState, ErrorState, Num } from "../ui";
import { SubBoard } from "./SubBoard";
import { LineupPicker } from "./LineupPicker";
import { ShotPredictor } from "./ShotPredictor";
import { StarFilledIcon, SwapIcon, TargetIcon } from "../icons";
import { formatCountdown, isOpen, requiresLineup, type MatchStatus } from "../../lib/predictionWindow";
import { useNow } from "../../hooks/useNow";

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
  const { t, localize } = useI18n();
  const { push } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["predictions", matchId],
    queryFn: () => api.getMyPredictions(matchId),
  });
  const rows = query.data?.predictions ?? [];
  const windows = query.data?.windows ?? {};
  const matchStatus = (query.data?.matchStatus ?? "scheduled") as MatchStatus;
  // True once the official lineup is out — the gate the lineup-dependent
  // mechanics wait on, alongside their own clock windows.
  const lineupsPublished = query.data?.lineupPublished ?? false;
  const live = matchStatus === "live";
  const halftime = matchStatus === "halftime";
  const finished = matchStatus === "finished";

  const [editor, setEditor] = useState<Mechanic | null>(null);
  // Save confirmation: the just-saved card wears the volt goal sweep for one
  // beat, so the optimistic row reads as "accepted" rather than "maybe".
  const [flash, setFlash] = useState<Mechanic | null>(null);
  // Ticking clock: the countdown strings below are derived, not polled, so
  // without this they would freeze until an unrelated refetch.
  const now = useNow(30_000);

  // goal-flash paints over --t-slow (450ms); clear after the sweep lands so
  // the class (and its ::after) can't replay on a later re-render.
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 650);
    return () => clearTimeout(id);
  }, [flash]);

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

  // Player names for the saved-pick summaries ("Saka v Vinicius", not "#123 v
  // #456"). Same query key as the lineups tab and the pick editors, so once
  // any of them loaded, this is a cache hit — no extra request on the page.
  const lineups = useQuery({
    queryKey: ["lineups", matchId],
    queryFn: () => api.getLineups(matchId),
    staleTime: 60_000,
    enabled: rows.some(
      (r) => r.mechanic === "player_watch" || r.mechanic === "shot_predict" || r.mechanic === "versus",
    ),
  });
  const nameOf = (id: string): string => {
    const p = lineups.data?.players.find((x) => x.player_id === id);
    return p ? localize(p.full_name) : `#${id}`;
  };

  const statusChip = (row: ApiPrediction | null) => {
    if (!row) return null;
    if (row.status === "pending")
      return (
        <Chip tone="muted" className="marker-pop">
          {t("predict.pending")}
        </Chip>
      );
    // Awards pop in (marker-pop, transform + opacity only) rather than
    // appearing at full size — the one moment the pick paid off.
    if (row.status === "correct")
      return (
        <Chip tone="pitch" className="marker-pop">
          +{row.points_awarded}
        </Chip>
      );
    if (row.status === "partial")
      return (
        <Chip tone="gold" className="marker-pop">
          +{row.points_awarded}
        </Chip>
      );
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
    return formatCountdown(w.lockAt, now) ?? t("predict.locked");
  };

  const mechanics: Mechanic[] = ["lineup", "sub", "shot_predict", "player_watch", "versus"];

  // One state machine for the whole app (src/lib/predictionWindow.ts): the
  // same rules the server enforces, so a card never looks tappable when the
  // POST would answer LOCKED_MATCH_STARTED. Notably this closes every non-Sub
  // mechanic the instant the match kicks off, instead of trusting opensAt.
  const opensNow = (m: Mechanic) => isOpen(m, windows[m], { matchStatus, lineupsPublished, now });

  // Open-and-unpicked first: the list reads as the next step, not a five-row
  // checklist. Re-ranked ONLY when the open/picked picture actually changes —
  // the 30s countdown tick must not shuffle cards under the user's thumb.
  const orderKey = mechanics.map((m) => `${opensNow(m) ? "o" : "-"}${byMechanic(m) ? "p" : "-"}`).join("");
  const orderedRef = useRef<Mechanic[]>(mechanics);
  const orderKeyRef = useRef<string | null>(null);
  if (orderKeyRef.current !== orderKey) {
    orderKeyRef.current = orderKey;
    const rank = (m: Mechanic) => Number(!(opensNow(m) && !byMechanic(m)));
    orderedRef.current = [...mechanics].sort((a, b) => rank(a) - rank(b));
  }
  const ordered = orderedRef.current;

  // One action leads, not five: the first mechanic that is open and still
  // unpicked wears volt. Five identical primary buttons read as a checklist
  // with no next step, which is the opposite of a deadline.
  const primaryMechanic = ordered.find((m) => !byMechanic(m) && opensNow(m));

  const kickoffMs = windows.shot_predict ? new Date(windows.shot_predict.lockAt).getTime() : null;
  const minutesToKickoff = kickoffMs ? (kickoffMs - now) / 60_000 : null;
  const showLockSoon =
    matchStatus === "scheduled" &&
    minutesToKickoff !== null &&
    minutesToKickoff > 0 &&
    minutesToKickoff <= 60 &&
    rows.length < 5;
  const showHowTo = matchStatus === "scheduled" && rows.length === 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 text-[11px] text-ink-3">{t("predict.hubHint")}</p>
        {/* The scoring tables live in the app now, not only in scoring-rules.md. */}
        <RulesButton variant="link" />
      </div>
      {showLockSoon ? (
        <Card className="border-danger/50 bg-danger/5 p-2.5">
          <span className="text-[11px] font-bold text-danger animate-pulse">{t("predict.lockSoon")}</span>
        </Card>
      ) : null}
      {showHowTo ? (
        <Card className="border-volt/40 bg-elevated p-3">
          <p className="text-xs font-bold text-ink">{t("predict.howToTitle")}</p>
          <p className="mt-1 text-[11px] text-ink-2">{t("predict.howToBody")}</p>
        </Card>
      ) : null}
      {halftime ? (
        <Card className="border-live/40 p-2.5">
          <span className="text-[11px] font-bold text-live">{t("sub.halftimeBanner")}</span>
        </Card>
      ) : null}

      {query.isLoading ? (
        <PredictionsHubSkeleton />
      ) : (
        ordered.map((m) => {
          const meta = MECHANIC_META[m];
          const row = byMechanic(m);
          const notOpenYet = !opensNow(m);
          // Gated and still waiting on ESPN's XI: the card explains itself
          // rather than showing a kickoff countdown that hasn't started.
          const lineupLocked = !finished && requiresLineup(m, windows[m]) && !lineupsPublished;
          return (
            <Card
              key={m}
              className={cx(
                // Skeleton → content: the card crossfades in once when the
                // hub finishes loading (its key is stable, so saves and the
                // 30s countdown tick don't replay it).
                "fade-swap p-3",
                row && "border-volt/40",
                // relative + overflow-hidden frame goal-flash's ::after sweep.
                flash === m && "relative overflow-hidden goal-flash",
              )}
            >
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
                  {lineupLocked
                    ? t("predict.waitLineupHint")
                    : m === "sub"
                      ? t("predict.lockHT")
                      : `${t(meta.lockKey as never)}${!notOpenYet && !live && !finished ? ` · ${windowInfo(m) ?? ""}` : ""}`}
                </span>
                {row?.payload ? <MechanicSummary mechanic={m} payload={row.payload} nameOf={nameOf} /> : null}
                {!finished && !halftime ? (
                  <Button
                    variant={m === primaryMechanic ? "primary" : "ghost"}
                    className="px-3 text-xs"
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

      {editor ? (
        <MechanicEditor
          mechanic={editor}
          matchId={matchId}
          live={live}
          existing={byMechanic(editor)}
          onClose={() => setEditor(null)}
          onSaved={() => {
            // Invalidate (don't await): the optimistic row already shows; the
            // refetch replaces it with server truth (lock windows, ids).
            if (editor) setFlash(editor);
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
        <EmptyState title={t("predict.awaitLineupTitle")} hint={t("predict.awaitLineupHint")} />
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
                "flex w-full items-center gap-3 rounded-card border p-2.5 text-start transition-[color,background-color,transform] duration-[var(--t-fast)] active:scale-[0.98]",
                pick === p.player_id ? "border-gold bg-elevated" : "border-line bg-surface hover:bg-elevated",
              )}
            >
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                {localize(p.full_name)}
              </span>
              <Chip tone="muted" normalCase>
                {p.position}
              </Chip>
              {pick === p.player_id ? (
                <Chip tone="gold" className="marker-pop">
                  {t("watch.selected")}
                </Chip>
              ) : null}
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
        <EmptyState title={t("predict.awaitLineupTitle")} hint={t("predict.awaitLineupHint")} />
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
                    "flex w-full items-center gap-3 rounded-card border p-2.5 text-start transition-[color,background-color,transform] duration-[var(--t-fast)] active:scale-[0.98]",
                    (index === 0 ? sideA : sideB) === p.player_id
                      ? "border-volt bg-elevated"
                      : "border-line bg-surface hover:bg-elevated",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink">
                    {localize(p.full_name)}
                  </span>
                  {(index === 0 ? sideA : sideB) === p.player_id ? (
                    <Chip tone="volt" className="marker-pop">
                      {t("watch.selected")}
                    </Chip>
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

function MechanicSummary({
  mechanic,
  payload,
  nameOf,
}: {
  mechanic: Mechanic;
  payload: string;
  /** Player id → localized name (falls back to #id when lineups aren't in yet). */
  nameOf: (id: string) => string;
}) {
  const { t } = useI18n();
  const parsed = safeParse(payload) as Record<string, unknown> | null;
  if (!parsed) return null;

  // One implementation for every mechanic, shared with the history page
  // (src/lib/breakdown.ts) so the two screens can never disagree about what a
  // pick says. `nameOf` supplies this match's lineups — a cache hit here.
  const summary = pickSummary(mechanic, payload, { t, nameOf });
  if (summary) {
    return (
      <span className="max-w-[50%] truncate text-[10px] text-ink-3" dir="auto">
        {summary}
      </span>
    );
  }
  // No payload we can summarize: fall back to a bare count rather than nothing.
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
