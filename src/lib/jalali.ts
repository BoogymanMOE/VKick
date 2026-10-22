/**
 * Jalali (Solar Hijri) ⇄ Gregorian calendar conversion.
 *
 * Pure math — no Intl dependency — so the calendar sheet's grid can be built
 * from Jalali months and still produce the real `Date` objects the app files
 * matches under. The algorithm is the standard Khayyam-style "breaks" table
 * (the one publicized as jalaali-js): a port, not an invention, and pinned
 * against Intl's own `ca-persian` conversion in tests/jalali.test.ts.
 *
 * Everything is LOCAL: `toJalali` reads a Date's local Y/M/D the same way
 * `dayKey` does, and `jalaliToGregorian` builds a local-midnight Date. UTC
 * helpers would file east-of-UTC days (this app's users are UTC+3:30) under
 * the wrong day.
 */

/** `trunc(a / b)` — exactly what jalaali-js's `~~(a / b)` does. NOT floor. */
const div = (a: number, b: number) => Math.trunc(a / b);
/** Truncated remainder, paired with `div` above. */
const mod = (a: number, b: number) => a - Math.trunc(a / b) * b;

/**
 * Leap-year boundaries between 33-year cycles (AP years 1..3177). Any year
 * outside throws — centuries beyond any plausible user, but not silently
 * misconverted.
 */
const BREAKS: number[] = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192,
  2262, 2324, 2394, 2456, 3178,
];

/** Days from the epoch (4713 BC Jan 1 Julian) for a Gregorian date. */
function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

/** Gregorian date for a day count from `g2d`. */
function d2g(jdn: number): { gy: number; gm: number; gd: number } {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

/**
 * Where the Jalali year sits in its 33-year cycle: the day in March Gregorian
 * Nawruz falls on (`march`), and a cycle marker (`leap`) the ported d2j needs.
 */
function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0];
  let jump = 0;
  let n = 0;
  if (jy < jp || jy >= BREAKS[bl - 1]) throw new Error(`Jalali year out of range: ${jy}`);
  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

/** Leap-year test used for Esfand's length (leap Jalali year → 30 days). */
function isJalaliLeap(jy: number): boolean {
  const bl = BREAKS.length;
  const jp0 = BREAKS[0];
  if (jy < jp0 || jy >= BREAKS[bl - 1]) throw new Error(`Jalali year out of range: ${jy}`);
  let leapJ = -14;
  let jp = jp0;
  let jump = 0;
  let n = 0;
  for (let i = 1; i < bl; i += 1) {
    const jm = BREAKS[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  n = jy - jp;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return leap === 0;
}

/** Day count for a Jalali date (inverse construction of j2d/d2j). */
function j2d(jy: number, jm: number, jd: number): number {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

export interface JalaliDate {
  /** Jalali (AP) year. */
  jy: number;
  /** Jalali month, 1 (Farvardin) .. 12 (Esfand). */
  jm: number;
  /** Jalali day of month, 1..31. */
  jd: number;
}

/** The Jalali date of a Date, read from its LOCAL Y/M/D. */
export function toJalali(date: Date): JalaliDate {
  const jdn = g2d(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const gy = d2g(jdn).gy;
  const r = jalCal(gy - 621);
  const jdn1f = g2d(gy, 3, r.march);
  const jy = gy - 621;
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy: jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    k += 179;
    if (r.leap === 1) k += 1;
    return { jy: jy - 1, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

/** The LOCAL Date of a Jalali date (`new Date(gy, gm-1, gd)` — midnight). */
export function jalaliToGregorian(jy: number, jm: number, jd: number): Date {
  const { gy, gm, gd } = d2g(j2d(jy, jm, jd));
  return new Date(gy, gm - 1, gd);
}

/** Days in a Jalali month: 31 / 30 for months 1–11, 29 or 30 for Esfand. */
export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm < 1 || jm > 12) throw new Error(`Jalali month out of range: ${jm}`);
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeap(jy) ? 30 : 29;
}

/**
 * Jalali months are 1-based, so month arithmetic must run on a 0-based index:
 * Farvardin 1404 minus one is Esfand 1403.
 */
export function addJalaliMonths(jy: number, jm: number, delta: number): { jy: number; jm: number } {
  const idx = jy * 12 + (jm - 1) + delta;
  return { jy: Math.floor(idx / 12), jm: mod(idx, 12) + 1 };
}

/** Stable ordering key for a Jalali year/month pair (mimics addJalaliMonths). */
export function jalaliMonthIndex(jy: number, jm: number): number {
  return jy * 12 + (jm - 1);
}

/** Persian month names, Farvardin first. */
export const JALALI_MONTHS_FA = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
] as const;
