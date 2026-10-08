/**
 * Privacy and Terms: the route paths and every string the pages render.
 *
 * The pages are data-driven (src/lib/legal.ts), so "the page renders in both
 * languages" reduces to a checkable property: each registered route resolves to
 * a title plus a non-empty {title, body} section list, in BOTH EN and FA, with
 * the Persian prose genuinely different from the English (a forgotten
 * translation is a build-breaking blank section, not a silent one).
 *
 * App.tsx imports LEGAL_ROUTES for the <Route path> values, so asserting those
 * constants also pins where the pages live.
 */
import { strict as assert } from "node:assert";
import { strings } from "../src/i18n/strings.js";
import { LEGAL_ROUTES, LEGAL_SECTIONS, LEGAL_TITLES, type LegalKind } from "../src/lib/legal.js";

const LANGS = ["en", "fa"] as const;

export function runLegalTests(): void {
  assert.deepEqual(
    Object.values(LEGAL_ROUTES).sort(),
    ["/privacy", "/terms"],
    "the legal routes are /privacy and /terms",
  );

  const kinds = Object.keys(LEGAL_SECTIONS) as LegalKind[];
  assert.deepEqual(kinds.sort(), ["privacy", "terms"], "both documents are defined");

  for (const kind of kinds) {
    for (const lang of LANGS) {
      const t = strings[lang] as Record<string, string>;
      const title = t[LEGAL_TITLES[kind]];
      assert.ok(title && title.trim(), `${lang}: ${LEGAL_TITLES[kind]} is missing or empty`);
      assert.ok(LEGAL_SECTIONS[kind].length > 0, `${kind} has sections`);
      for (const section of LEGAL_SECTIONS[kind]) {
        const heading = t[section.title];
        const body = t[section.body];
        assert.ok(
          typeof heading === "string" && heading.trim().length > 0,
          `${lang}: ${section.title} is missing or empty`,
        );
        assert.ok(
          typeof body === "string" && body.trim().length > 0,
          `${lang}: ${section.body} is missing or empty`,
        );
      }
    }
  }

  // No untranslated prose: every FA body must differ from the EN one.
  for (const kind of kinds) {
    for (const section of LEGAL_SECTIONS[kind]) {
      assert.notEqual(
        strings.en[section.body],
        strings.fa[section.body],
        `${section.body} is identical in EN and FA (untranslated)`,
      );
    }
  }

  // The topics the docs must actually cover.
  const required = [
    "legal.privacy.stored.title",
    "legal.privacy.espn.title",
    "legal.privacy.ads.title",
    "legal.privacy.delete.title",
    "legal.privacy.contact.title",
    "legal.terms.espn.title",
    "legal.terms.delete.title",
    "legal.terms.contact.title",
  ] as const;
  for (const key of required) {
    for (const lang of LANGS) {
      const value = (strings[lang] as Record<string, string>)[key];
      assert.ok(value && value.trim(), `${lang}: required legal key ${key} is missing`);
    }
  }

  console.log("  legal: /privacy + /terms routes, EN/FA sections present, distinct and complete OK");
}
