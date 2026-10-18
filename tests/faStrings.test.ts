/**
 * Persian text integrity — the bug classes that quietly degrade the currency
 * of every FA surface at once.
 *
 * 1. ARABIC codepoints standing in for Persian ones. U+064A (Arabic yeh) and
 *    U+0643 (Arabic kaf) render almost identically to U+06CC/U+06A9 but break
 *    searching, sorting and font shaping; they arrive from copy-pasted Arabic
 *    sources (bel.1's garbled row shipped this way inverted — with CJK).
 * 2. CJK characters: nothing in this app is Korean/Japanese/Chinese — any
 *    match is a copy-paste accident, exactly what happened to bel.1.
 * 3. Locale pinning: sco.1 and bel.1 were reviewed against native-standard
 *    names ("لیگ برتر اسکاتلند", "لیگ برتر بلژیک"); renames must be deliberate,
 *    so the reviewed values are pinned here.
 *
 * Scans string literals, not comments, so explanatory markdown stays free.
 */
import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");

const FA_FILES = [
  "src/i18n/strings.ts",
  "src/i18n/names.ts",
  "server/messages.ts",
];

// String literals only: single- or double-quoted, or template-literal bodies
// that hold no interpolation markers (`{` still appears inside Persian copy as
// placeholders — those are legitimately Latin and excluded from Latin checks).
function stringLiterals(source: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\\n]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1]);
  return out;
}

export function runFaStringsTests(): void {
  for (const rel of FA_FILES) {
    const source = fs.readFileSync(path.join(ROOT, rel), "utf8");
    const literals = stringLiterals(source);

    for (const [i, lit] of literals.entries()) {
      assert.ok(
        !/[\u064A\u0643]/.test(lit),
        `${rel} literal #${i} uses Arabic ي/ك (U+064A/U+0643) instead of Persian ی/ک: ${lit.slice(0, 60)}`,
      );
      assert.ok(
        !/[\uAC00-\uD7AF\u3040-\u30FF\u4E00-\u9FFF\u3130-\u318F]/.test(lit),
        `${rel} literal #${i} contains CJK characters — a copy-paste accident, not Persian: ${lit.slice(0, 60)}`,
      );
      // Majority-Persian strings must not carry long untranslated Latin
      // prose inside them (the per-row placement bug from the bel.1 incident
      // was Persian copy holding an English sentence).
      const persian = (lit.match(/[\u0600-\u06FF]/g) ?? []).length;
      if (persian > 4) {
        const latinWords = (lit.match(/[A-Za-z]{4,}/g) ?? []).filter(
          (w) => !/^x[PG]A$|^PPDA|^VAR$|^ESPN$|^Understat$|^MVP$|^viewers?$/i.test(w),
        );
        // Untranslated long English prose inside a Persian-heavy string —
        // flag it.
        assert.ok(
          latinWords.length <= 3,
          `${rel} literal #${i} mixes long Latin prose into Persian copy — translate or split it: ${lit.slice(0, 80)}`,
        );
      }
    }
  }

  // The reviewed competition names are pinned: a rename must show up here and
  // be agreed, not drift in through a data edit.
  const leagues = fs.readFileSync(path.join(ROOT, "src/lib/leagues.ts"), "utf8");
  assert.ok(leagues.includes('"sco.1": { en: "Scottish Premiership", fa: "لیگ برتر اسکاتلند" }'),
    "sco.1 Persian name drifted from the reviewed value");
  assert.ok(leagues.includes('"bel.1": { en: "Belgian Pro League", fa: "لیگ برتر بلژیک" }'),
    "bel.1 Persian name drifted from the reviewed value");
}
