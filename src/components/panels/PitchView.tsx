import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type ApiTimelineEvent } from "../../lib/api";
import { useI18n } from "../../i18n/context";
import { Card, Chip, Num, Segmented } from "../ui";
import { cellZone, cellFromFieldPosition, GRID_COLS, GRID_ROWS, ZONE_LABEL_KEY } from "../../lib/zones";

type Side = { id: string; shortName: string; color: string };

/** An event the feed actually placed on the pitch — the only kind we can draw. */
type LocatedEvent = ApiTimelineEvent & { field_x: number; field_y: number };

function isLocated(event: ApiTimelineEvent): event is LocatedEvent {
  return (
    event.field_x !== null &&
    event.field_y !== null &&
    Number.isFinite(event.field_x) &&
    Number.isFinite(event.field_y)
  );
}

/**
 * The live shot plot: every event ESPN gave a position to, drawn twice — in the
 * 6×4 grid the Shot Predictor is scored against, and on a to-scale pitch.
 *
 * WHERE THE DATA COMES FROM, AND WHAT IT CAN'T SHOW
 * ESPN fills `fieldPositionX/Y` on key events, and in practice only on goals and
 * the occasional shot — the sync stores exactly what arrives (`timeline_events.
 * field_x/field_y/goal_y`) and this plot draws exactly that. There is no pass
 * feed in the payload at all, so nothing here invents one: an empty pitch means
 * the feed located nothing, and the hint says so rather than implying the match
 * had no shots. It refreshes with the timeline query the Timeline tab owns, so
 * a goal that lands mid-match appears here without a reload.
 */
export function PitchView({
  matchId,
  live,
  home,
  away,
}: {
  matchId: string;
  /** Live matches refresh on the same 20s beat as the header and timeline. */
  live: boolean;
  home: Side;
  away: Side;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"grid" | "pitch">("grid");

  // Same key as the Timeline tab, so the two share one cache entry and one
  // in-flight request instead of polling ESPN-synced rows twice.
  const query = useQuery({
    queryKey: ["timeline", matchId],
    queryFn: () => api.getTimeline(matchId),
    refetchInterval: live ? 20_000 : false,
  });

  const located = useMemo(() => (query.data?.events ?? []).filter(isLocated), [query.data]);

  return (
    <Card className="p-3">
      {/* The title and count live here rather than in a SectionHeading above:
          the count is this panel's own data, and a heading plus a header row
          printed "Pitch View" twice. */}
      <div className="mb-3 flex items-center gap-2">
        <span className="label label-lg text-ink-2">{t("pitchView.title")}</span>
        <span className="flex-1" />
        <Chip tone="pitch">
          <Num>{located.length}</Num>
        </Chip>
      </div>

      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: "grid", label: t("pitchView.grid") },
          { value: "pitch", label: t("pitchView.full") },
        ]}
      />

      <p className="mt-2 mb-2 text-[11px] text-ink-3">{t("pitchView.hint")}</p>

      {mode === "grid" ? (
        <GoalGrid events={located} home={home} away={away} />
      ) : (
        <FullPitch events={located} home={home} away={away} />
      )}

      {located.length === 0 ? (
        <p className="mt-3 rounded-card border border-dashed border-line px-3 py-4 text-center text-[11px] text-ink-3">
          <span className="block font-bold text-ink-2">{t("pitchView.empty")}</span>
          {t("pitchView.emptyHint")}
        </p>
      ) : (
        <Legend events={located} home={home} away={away} />
      )}
    </Card>
  );
}

/** Which club a located event belongs to, as a colour. */
function colorFor(teamId: string | null, home: Side, away: Side): string {
  if (teamId === home.id) return home.color;
  if (teamId === away.id) return away.color;
  return "var(--text-muted)";
}

/**
 * Who is who, and what a marker means. The counts live in the header chip — a
 * number next to a singular noun ("3 Goal") is what two unpluralised labels
 * produce, and the app has no plural machinery to fix it with. The two marker
 * styles are the thing a reader cannot infer.
 */
function Legend({ events, home, away }: { events: LocatedEvent[]; home: Side; away: Side }) {
  const { t, localize } = useI18n();
  const hasShot = events.some((e) => e.type !== "goal");

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line pt-2">
      {[home, away].map((side) => (
        <span key={side.id} className="inline-flex items-center gap-1.5 text-[11px] text-ink-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: side.color }}
            aria-hidden="true"
          />
          <span className="truncate">{localize(side.shortName)}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
        <span className="h-2.5 w-2.5 rounded-full ring-1 ring-white/70" aria-hidden="true" />
        {t("pitchView.goal")}
      </span>
      {hasShot ? (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-3">
          <span className="h-2.5 w-2.5 rounded-full border border-white/70" aria-hidden="true" />
          {t("pitchView.shot")}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The Shot Predictor's own grid, with the match's real shots dropped into their
 * cells. Same geometry as the picker (`cellFromFieldPosition`, mirrored by
 * `src/lib/zones.ts` and pinned by tests/shotGrid.test.ts), so a goal plotted in
 * "inside left" is in the cell the picker would have scored for it.
 */
function GoalGrid({ events, home, away }: { events: LocatedEvent[]; home: Side; away: Side }) {
  const { t } = useI18n();

  const byCell = useMemo(() => {
    const map = new Map<string, LocatedEvent[]>();
    for (const event of events) {
      const { gridX, gridY } = cellFromFieldPosition(event.field_x, event.field_y);
      const key = `${gridX}-${gridY}`;
      const bucket = map.get(key);
      if (bucket) bucket.push(event);
      else map.set(key, [event]);
    }
    return map;
  }, [events]);

  const cells = Array.from({ length: GRID_ROWS * GRID_COLS }, (_, i) => ({
    gridX: i % GRID_COLS,
    gridY: Math.floor(i / GRID_COLS),
  }));

  return (
    // A pitch never mirrors with the reading direction — left stays left in fa.
    <div dir="ltr">
      <p className="mb-1 text-center label text-ink-3">↑ {t("shot.attackingEnd")}</p>
      <div className="relative overflow-hidden rounded-card border border-line bg-pitch/20 p-2">
        <div className="relative grid gap-0.5" style={{ gridTemplateColumns: `repeat(${GRID_COLS}, 1fr)` }}>
          {cells.map(({ gridX, gridY }) => {
            const pins = byCell.get(`${gridX}-${gridY}`) ?? [];
            const zone = cellZone(gridX, gridY);
            return (
              <div
                key={`${gridX}-${gridY}`}
                role="img"
                aria-label={`${t(ZONE_LABEL_KEY[zone])} · ${pins.length}`}
                className="relative flex aspect-[4/3] flex-wrap content-center items-center justify-center gap-0.5 rounded-[4px] border border-white/10 bg-white/5 p-0.5"
              >
                {pins.slice(0, 4).map((pin) => (
                  <span
                    key={pin.id}
                    title={`${pin.minute_display} · ${pin.description}`}
                    className="block h-2 w-2 rounded-full ring-1 ring-white/70"
                    style={{
                      backgroundColor:
                        pin.type === "goal" ? colorFor(pin.team_id, home, away) : "transparent",
                      borderColor: colorFor(pin.team_id, home, away),
                    }}
                  />
                ))}
                {pins.length > 4 ? (
                  <Num className="text-[9px] font-bold text-ink-2">+{pins.length - 4}</Num>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Markings painted over the cells — goal line, penalty area, six-yard
            box, spot and the halfway line — the same geometry the Shot
            Predictor draws, so the grid reads as a pitch, not a keypad. */}
        <div className="pointer-events-none absolute inset-2" aria-hidden="true">
          <span className="absolute inset-x-0 top-0 h-px bg-white/40" />
          <span className="absolute top-0 left-1/2 h-[18%] w-[57%] -translate-x-1/2 border-x border-b border-white/25" />
          <span className="absolute top-0 left-1/2 h-[7%] w-[28%] -translate-x-1/2 border-x border-b border-white/20" />
          <span className="absolute top-[13%] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white/50" />
          <span className="absolute inset-x-0 top-1/2 h-px bg-white/15" />
          <span className="absolute top-1/2 left-1/2 aspect-square h-[24%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- full pitch */

/** A real pitch is 105m × 68m, and the diagram is drawn to those proportions. */
const PITCH_W = 68;
const PITCH_H = 105;
const BOX_W = 40.32;
const BOX_D = 16.5;
const SIX_W = 18.32;
const SIX_D = 5.5;
const GOAL_W = 7.32;
const ARC_R = 9.15;
/** Where a 9.15m arc crosses the 16.5m box edge: 34 ± sqrt(9.15² − 5.5²). */
const ARC_X1 = (34 - 7.31).toFixed(2);
const ARC_X2 = (34 + 7.31).toFixed(2);

/**
 * ESPN field coordinates → diagram points. `fieldPositionX` runs to the
 * opponent's goal (drawn at the top) and `fieldPositionY` across the width, so
 * both sides' shots converge on one goal — the standard shot-map read.
 */
function toPoint(fieldX: number, fieldY: number): { x: number; y: number } {
  return { x: (fieldY / 100) * PITCH_W, y: ((100 - fieldX) / 100) * PITCH_H };
}

function FullPitch({ events, home, away }: { events: LocatedEvent[]; home: Side; away: Side }) {
  const { t } = useI18n();
  return (
    <div dir="ltr" className="overflow-hidden rounded-card border border-line bg-pitch/20 p-2">
      <svg
        viewBox={`0 0 ${PITCH_W} ${PITCH_H}`}
        className="block h-auto w-full"
        role="img"
        aria-label={t("pitchView.aria")}
      >
        <g fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="0.35">
          <rect x="0.2" y="0.2" width={PITCH_W - 0.4} height={PITCH_H - 0.4} rx="0.6" />
          <line x1="0.2" y1={PITCH_H / 2} x2={PITCH_W - 0.2} y2={PITCH_H / 2} />
          <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={ARC_R} />
          {/* Own end (bottom): penalty area, six-yard box, the D. */}
          <rect x={(PITCH_W - BOX_W) / 2} y={PITCH_H - BOX_D} width={BOX_W} height={BOX_D} />
          <rect x={(PITCH_W - SIX_W) / 2} y={PITCH_H - SIX_D} width={SIX_W} height={SIX_D} />
          <path d={`M ${ARC_X1} ${PITCH_H - BOX_D} A ${ARC_R} ${ARC_R} 0 0 1 ${ARC_X2} ${PITCH_H - BOX_D}`} />
          {/* Attacking end (top). */}
          <rect x={(PITCH_W - BOX_W) / 2} y="0" width={BOX_W} height={BOX_D} />
          <rect x={(PITCH_W - SIX_W) / 2} y="0" width={SIX_W} height={SIX_D} />
          <path d={`M ${ARC_X1} ${BOX_D} A ${ARC_R} ${ARC_R} 0 0 0 ${ARC_X2} ${BOX_D}`} />
        </g>
        <g fill="rgba(255,255,255,0.55)">
          <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r="0.7" />
          <circle cx={PITCH_W / 2} cy={PITCH_H - 11} r="0.7" />
          <circle cx={PITCH_W / 2} cy="11" r="0.7" />
        </g>
        <g stroke="rgba(255,255,255,0.55)" strokeWidth="0.9">
          <line x1={(PITCH_W - GOAL_W) / 2} y1={PITCH_H} x2={(PITCH_W + GOAL_W) / 2} y2={PITCH_H} />
          <line x1={(PITCH_W - GOAL_W) / 2} y1="0" x2={(PITCH_W + GOAL_W) / 2} y2="0" />
        </g>

        {/* The shots. A goal also draws the line the ball took to the goal
            mouth (`goal_y`), which is the part a scoreline can never show. */}
        {events.map((event) => {
          const point = toPoint(event.field_x, event.field_y);
          const color = colorFor(event.team_id, home, away);
          const isGoal = event.type === "goal";
          const crossing =
            isGoal && event.goal_y !== null ? { x: (event.goal_y / 100) * PITCH_W, y: 0 } : null;
          return (
            <g key={event.id}>
              <title>{`${event.minute_display} · ${event.description}`}</title>
              {crossing ? (
                <>
                  <line
                    x1={point.x}
                    y1={point.y}
                    x2={crossing.x}
                    y2={crossing.y}
                    stroke={color}
                    strokeWidth="0.3"
                    strokeDasharray="1 1"
                    opacity="0.7"
                  />
                  <circle
                    cx={crossing.x}
                    cy={crossing.y}
                    r="1.1"
                    fill={color}
                    stroke="white"
                    strokeWidth="0.3"
                  />
                </>
              ) : null}
              <circle
                cx={point.x}
                cy={point.y}
                r="2.3"
                fill={isGoal ? color : "none"}
                stroke={isGoal ? "rgba(255,255,255,0.8)" : color}
                strokeWidth={isGoal ? "0.4" : "0.7"}
              />
              <text x={point.x + 3.2} y={point.y + 1} fontSize="2.8" fill="rgba(255,255,255,0.75)">
                {event.minute_display}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
