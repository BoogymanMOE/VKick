/**
 * Legal pages — Privacy and Terms — as data.
 *
 * The route paths live here and App.tsx imports them, so the router and the
 * test cannot disagree about where these pages live. Each page is a list of
 * {title, body} string keys; the page component renders exactly this list and
 * tests/legal.test.ts asserts every key resolves in BOTH languages (EN/FA
 * parity is a build invariant — a missing Persian string is a blank section).
 *
 * The contact sections carry a visible placeholder the owner fills in with a
 * real address before launch.
 */
import type { StringKey } from "../i18n/strings";

export const LEGAL_ROUTES = {
  privacy: "/privacy",
  terms: "/terms",
} as const;

export type LegalKind = keyof typeof LEGAL_ROUTES;

export interface LegalSection {
  title: StringKey;
  body: StringKey;
}

export const LEGAL_TITLES: Record<LegalKind, StringKey> = {
  privacy: "legal.privacyTitle",
  terms: "legal.termsTitle",
};

export const LEGAL_SECTIONS: Record<LegalKind, LegalSection[]> = {
  privacy: [
    { title: "legal.privacy.stored.title", body: "legal.privacy.stored.body" },
    { title: "legal.privacy.where.title", body: "legal.privacy.where.body" },
    { title: "legal.privacy.espn.title", body: "legal.privacy.espn.body" },
    { title: "legal.privacy.ads.title", body: "legal.privacy.ads.body" },
    { title: "legal.privacy.delete.title", body: "legal.privacy.delete.body" },
    { title: "legal.privacy.contact.title", body: "legal.privacy.contact.body" },
  ],
  terms: [
    { title: "legal.terms.use.title", body: "legal.terms.use.body" },
    { title: "legal.terms.content.title", body: "legal.terms.content.body" },
    { title: "legal.terms.espn.title", body: "legal.terms.espn.body" },
    { title: "legal.terms.ads.title", body: "legal.terms.ads.body" },
    { title: "legal.terms.delete.title", body: "legal.terms.delete.body" },
    { title: "legal.terms.contact.title", body: "legal.terms.contact.body" },
  ],
};
