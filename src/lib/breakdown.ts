/**
 * "Why did I get X" line items for a resolved prediction.
 *
 * The server stores exactly what its scoring functions returned
 * (`server/scoring/predictionScore.ts`), so the keys below mirror those records
 * rather than defining a schema of their own — the same arrangement as
 * `i18n/names.ts`: a two-language lookup keyed by data the server owns.
 *
 * Unknown keys are humanized instead of dropped, so a mechanic that grows a new
 * line item shows up here readable enough without a client change.
 */
export type BreakdownLang = "en" | "fa";

/**
 * Gates and flags, not score contributions — rendered as ✓ / — instead of a
 * raw number, because "1" reads as a point when it is really "passed".
 */
const FLAG_KEYS = new Set([
  "statGate",
  "crowdGate",
  "zoneExact",
  "zoneAdjacent",
  "lenientSoT",
  "zoneFromFallback",
  "forcedByWindow",
]);

const LABELS: Record<string, { en: string; fa: string }> = {
  // lineup
  startersCorrect: { en: "Starters called right", fa: "بازیکنان ترکیب درست" },
  formationBonus: { en: "Formation bonus", fa: "پاداش آرایش" },
  // sub board
  pairsPredicted: { en: "Sub pairs predicted", fa: "تعویض‌های پیش‌بینی‌شده" },
  offCorrect: { en: "Player coming off right", fa: "بازیکن خارج‌شده درست" },
  onCorrect: { en: "Player coming on right", fa: "بازیکن واردشده درست" },
  fullPairs: { en: "Complete pairs", fa: "تعویض‌های کامل" },
  // shot predictor
  zonePoints: { en: "Zone points", fa: "امتیاز ناحیه" },
  zoneExact: { en: "Exact zone", fa: "ناحیه دقیق" },
  zoneAdjacent: { en: "Adjacent zone", fa: "ناحیه مجاور" },
  onTargetBonus: { en: "On-target bonus", fa: "پاداش ضربه در چارچوب" },
  goalBonus: { en: "Goal bonus", fa: "پاداش گل" },
  lenientSoT: { en: "Stat sheet only (no zone hit)", fa: "فقط برگه آمار (بدون برخورد ناحیه)" },
  zoneFromFallback: { en: "Zone from a teammate's shot", fa: "ناحیه از شوت هم‌تیمی" },
  // player to watch
  statScore: { en: "Stat score", fa: "امتیاز آماری" },
  statAvg: { en: "Position average", fa: "میانگین پست" },
  statGate: { en: "Beat the stat gate", fa: "عبور از دروازه آمار" },
  crowdAvg: { en: "Crowd rating", fa: "امتیاز تماشاگران" },
  crowdPosAvg: { en: "Position crowd average", fa: "میانگین تماشاگران همان پست" },
  crowdGate: { en: "Beat the crowd gate", fa: "عبور از دروازه تماشاگران" },
  mvpBonus: { en: "MVP bonus", fa: "پاداش بهترین بازیکن" },
  forcedByWindow: { en: "Settled at the deadline", fa: "تسویه در پایان مهلت" },
  note: { en: "Nothing to score", fa: "چیزی برای امتیازدهی نبود" },
  // versus
  playerA: { en: "Your pick's stat score", fa: "امتیاز آماری انتخاب شما" },
  playerB: { en: "Rival's stat score", fa: "امتیاز آماری رقیب" },
};

export const MECHANIC_LABELS: Record<string, { en: string; fa: string }> = {
  lineup: { en: "Lineup", fa: "ترکیب" },
  shot_predict: { en: "Shot", fa: "شوت" },
  sub: { en: "Subs", fa: "تعویض" },
  player_watch: { en: "Player to watch", fa: "بازیکن تحت نظر" },
  versus: { en: "Versus", fa: "رودررو" },
};

export const STATUS_LABELS: Record<string, { en: string; fa: string }> = {
  pending: { en: "Pending", fa: "در انتظار" },
  correct: { en: "Correct", fa: "درست" },
  partial: { en: "Partial", fa: "ناقص" },
  wrong: { en: "Wrong", fa: "نادرست" },
  void: { en: "Void", fa: "باطل" },
};

/** camelCase -> "Camel case", for keys this file doesn't know yet. */
function humanize(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export interface BreakdownItem {
  key: string;
  label: string;
  value: string;
  /** Gates/flags, drawn quieter than score lines. */
  flag: boolean;
}

/**
 * Flatten a stored breakdown into drawable rows. Returns [] for null/garbage —
 * one malformed payload must not blank the screen.
 */
export function breakdownItems(raw: string | null, lang: BreakdownLang): BreakdownItem[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  return Object.entries(parsed as Record<string, unknown>).map(([key, value]) => {
    const flag = FLAG_KEYS.has(key);
    return {
      key,
      label: LABELS[key]?.[lang] ?? humanize(key),
      value: flag ? (Number(value) > 0 ? "✓" : "—") : String(value),
      flag,
    };
  });
}
