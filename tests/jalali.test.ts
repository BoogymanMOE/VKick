/**
 * The Jalali port has two independent sources of truth to agree with:
 *
 *  1. Intl's own Persian calendar (`fa-IR` defaults to `ca-persian` in every
 *     full-ICU runtime) — a completely different implementation. Any porting
 *     mistake drifts away from it and fails here.
 *  2. Round-trips: jalaliToGregorian(toJalali(d)) must return the same LOCAL
 *     day, because the app files matches under local day keys.
 *
 * Named edge cases anchor the leap-year logic: Jalali 1403 is a leap year, so
 * Esfand 1403 has 30 days and ends on Gregorian 2025-03-20; Nowruz 1404 is
 * therefore 2025-03-21. (Jalali leap years drift from Gregorian leap years —
 * 1404 is NOT a Gregorian leap year but Farvardin still starts the day after
 * the 1403 Esfand 30th.)
 */
import assert from "node:assert/strict";
import {
  addJalaliMonths,
  jalaliMonthLength,
  jalaliMonthIndex,
  jalaliToGregorian,
  JALALI_MONTHS_FA,
  toJalali,
} from "../src/lib/jalali.js";

/** One Intl-produced Jalali triple for a Date, or null if ICU lacks the calendar. */
function intlJalali(d: Date): { jy: number; jm: number; jd: number } | null {
  const fmt = new Intl.DateTimeFormat("en-US-u-ca-persian", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  });
  const parts = fmt.formatToParts(d);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const y = get("year");
  const m = get("month");
  const day = get("day");
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(day)) return null;
  return { jy: y, jm: m, jd: day };
}

const utcAtLocal = (d: Date) =>
  new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));

export function runJalaliTests(): void {
  // ICU sanity: if this runtime has no Persian calendar, Intl silently falls
  // back (or throws) — the cross-check below would be meaningless, so bail out
  // loudly in the miss report rather than asserting against the wrong thing.
  const probe = intlJalali(new Date(2025, 2, 21));
  if (probe === null) {
    console.log("[jalali] ICU lacks ca-persian — skipping Intl cross-check");
  } else {
    // Daily sweep across three years: covers two year boundaries and both
    // halves of the Jalali calendar.
    const start = new Date(2024, 0, 1);
    for (let i = 0; i < 3 * 366; i += 1) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const want = intlJalali(utcAtLocal(d));
      if (want === null) throw new Error("Intl lost the Persian calendar mid-sweep");
      const got = toJalali(d);
      assert.deepEqual(
        got,
        want,
        `toJalali(${d.toDateString()}) = ${got.jy}/${got.jm}/${got.jd}, Intl says ${want.jy}/${want.jm}/${want.jd}`,
      );
      // Round-trip: the calendar sheet builds cells from these Dates.
      const back = jalaliToGregorian(got.jy, got.jm, got.jd);
      assert.equal(
        `${back.getFullYear()}-${back.getMonth()}-${back.getDate()}`,
        `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
        `round-trip broke for ${d.toDateString()}`,
      );
    }
    // Month lengths: 31/30 halves and the 1403 leap Esfand.
    assert.equal(jalaliMonthLength(1403, 1), 31);
    assert.equal(jalaliMonthLength(1403, 6), 31);
    assert.equal(jalaliMonthLength(1403, 11), 30);
    assert.equal(jalaliMonthLength(1403, 12), 30, "Jalali 1403 is a leap year: Esfand has 30 days");
    assert.equal(jalaliMonthLength(1404, 12), 29, "Jalali 1404 is not a leap year");
  }

  // Named day anchor: Jalali 1404-01-01 == Gregorian 2025-03-21 (Nowruz).
  const nowruz = jalaliToGregorian(1404, 1, 1);
  assert.deepEqual(
    [nowruz.getFullYear(), nowruz.getMonth() + 1, nowruz.getDate()],
    [2025, 3, 21],
    "Nowruz 1404 must be 2025-03-21",
  );
  assert.deepEqual(toJalali(new Date(2025, 2, 21)), { jy: 1404, jm: 1, jd: 1 });
  assert.deepEqual(toJalali(new Date(2025, 2, 20)), { jy: 1403, jm: 12, jd: 30 });

  // Month arithmetic: year wrap both directions.
  assert.deepEqual(addJalaliMonths(1404, 3, 10), { jy: 1405, jm: 1 });
  assert.deepEqual(addJalaliMonths(1404, 1, -1), { jy: 1403, jm: 12 });
  // A Jalali month negative offset never leaves month bounds, so the clamp
  // arithmetic never needs a day fixup.
  assert.deepEqual(addJalaliMonths(1404, 12, 1), { jy: 1405, jm: 1 });

  // Ordering helper agrees with addJalaliMonths.
  assert.equal(jalaliMonthIndex(1404, 12) + 1, jalaliMonthIndex(1405, 1));
  assert.equal(jalaliMonthIndex(1404, 1) - 1, jalaliMonthIndex(1403, 12));

  // Twelve names, starting at Farvardin.
  assert.equal(JALALI_MONTHS_FA.length, 12);
  assert.equal(JALALI_MONTHS_FA[0], "فروردین");
  assert.equal(JALALI_MONTHS_FA[11], "اسفند");
}
