/**
 * Screen-reader label keys: the two aria-label strings the comment composer
 * depends on must exist and be non-empty in BOTH languages.
 *
 * The composer passes these keys straight to `aria-label`, so a missing or
 * blank entry silently ships an unlabelled textarea / clip-link input to
 * assistive tech. This test is the tripwire that catches someone deleting or
 * emptying `comments.textAria` / `comments.mediaAria` in EN or FA.
 */
import { strict as assert } from "node:assert";
import { strings } from "../src/i18n/strings.js";

const LANGS = ["en", "fa"] as const;
const A11Y_KEYS = ["comments.textAria", "comments.mediaAria"] as const;

export function runA11yKeysTests(): void {
  for (const lang of LANGS) {
    const t = strings[lang] as Record<string, string>;
    for (const key of A11Y_KEYS) {
      const value = t[key];
      assert.ok(
        typeof value === "string" && value.trim().length > 0,
        `${lang}: aria-label key ${key} is missing or empty`,
      );
    }
  }

  console.log("  a11yKeys: comments.textAria + comments.mediaAria present in EN/FA OK");
}
