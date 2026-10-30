/**
 * Persian news, translated once and cached.
 *
 * The club and match News tabs are the app's only long-form reading surfaces,
 * and ESPN publishes them in English — inside an RTL Persian page that reads as
 * a half-finished app. This module caches one translation per article in
 * `news_translations` and serves it from there; the route overlays the cached
 * text over the English payload.
 *
 * The translator is a configuration, not an assumption: set
 * NEWS_TRANSLATE_URL (an OpenAI-compatible chat-completions endpoint),
 * NEWS_TRANSLATE_API_KEY and optionally NEWS_TRANSLATE_MODEL. With nothing
 * configured the module is a no-op and the client labels the article "English"
 * rather than pretending — no silent machine translation, no fake Persian.
 *
 * Translation runs OUTSIDE the request: the route answers immediately with
 * whatever is cached and the missing articles are filled in the background, so
 * the first reader after a sync gets English (labelled) and the next one gets
 * Persian. A failed or slow provider can never delay or break the news tab.
 */
import { all, getDb, run, type DB } from "../db/index.js";

/** Only Persian is translated today; the cache is keyed by language. */
export type NewsLang = "fa";

export interface TranslatableArticle {
  id: string;
  headline: string;
  description: string;
}

export interface CachedTranslation {
  headline: string;
  description: string | null;
}

/**
 * How long one article waits before we try the provider again after a failure.
 * Translation is decoration on the news tab, so an outage must not turn into a
 * request storm — one attempt per article per hour is plenty.
 */
const RETRY_AFTER_MS = 60 * 60_000;
/** Articles translated per background pass; a feed is a handful, never a flood. */
const BATCH = 8;

const attempted = new Map<string, number>();
let running = false;

function translator(): { url: string; key: string; model: string } | null {
  const url = process.env.NEWS_TRANSLATE_URL?.trim();
  const key = process.env.NEWS_TRANSLATE_API_KEY?.trim();
  if (!url || !key) return null;
  return { url, key, model: process.env.NEWS_TRANSLATE_MODEL?.trim() || "gpt-4o-mini" };
}

/** True when a translator is configured — the one switch the whole feature has. */
export function translationConfigured(): boolean {
  return translator() != null;
}

/** Cached translations for a set of article ids, keyed by id. */
export function cachedTranslations(
  ids: string[],
  lang: NewsLang = "fa",
  db: DB = getDb(),
): Map<string, CachedTranslation> {
  const out = new Map<string, CachedTranslation>();
  if (ids.length === 0) return out;
  const placeholders = ids.map(() => "?").join(",");
  const rows = all<CachedTranslation & { article_id: string }>(
    db,
    `SELECT article_id, headline, description FROM news_translations
     WHERE lang = ? AND article_id IN (${placeholders})`,
    [lang, ...ids],
  );
  for (const row of rows) {
    out.set(row.article_id, { headline: row.headline, description: row.description });
  }
  return out;
}

/**
 * Overlay cached translations on a news payload. `translated` is false for an
 * article still only in the source language, which is what lets the card say
 * so instead of presenting English as if it were Persian.
 */
export function withTranslation<T extends TranslatableArticle>(
  articles: T[],
  lang: string | null,
  db: DB = getDb(),
): Array<T & { translated: boolean }> {
  if (lang !== "fa") return articles.map((a) => ({ ...a, translated: false }));
  const cache = cachedTranslations(
    articles.map((a) => a.id),
    "fa",
    db,
  );
  return articles.map((article) => {
    const hit = cache.get(article.id);
    if (!hit) return { ...article, translated: false };
    return {
      ...article,
      headline: hit.headline || article.headline,
      description: hit.description ?? article.description,
      translated: true,
    };
  });
}

function parseTranslation(raw: string): CachedTranslation | null {
  // Providers sometimes wrap JSON in a markdown fence; take the object inside.
  const text = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    const parsed = JSON.parse(text) as { headline?: unknown; description?: unknown };
    const headline = typeof parsed.headline === "string" ? parsed.headline.trim() : "";
    if (!headline) return null;
    return {
      headline,
      description: typeof parsed.description === "string" ? parsed.description.trim() : null,
    };
  } catch {
    return null;
  }
}

async function translateOne(
  article: TranslatableArticle,
  engine: { url: string; key: string; model: string },
): Promise<CachedTranslation | null> {
  const response = await fetch(engine.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${engine.key}`,
    },
    body: JSON.stringify({
      model: engine.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You translate English football journalism into natural, fluent Persian (fa-IR) " +
            "for an Iranian football app. Keep club and player names in their common Persian " +
            "spelling. Translate the headline and the two-sentence summary; never add facts, " +
            "never editorialise. Reply with JSON only: {\"headline\": \"…\", \"description\": \"…\"}.",
        },
        {
          role: "user",
          content: JSON.stringify({ headline: article.headline, description: article.description }),
        },
      ],
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`translator HTTP ${response.status}`);
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  return typeof content === "string" ? parseTranslation(content) : null;
}

/**
 * Fill the cache for any of these articles that has no Persian yet. Fire and
 * forget: the caller has already answered the request. Never throws.
 */
export function fillTranslations(articles: TranslatableArticle[]): void {
  if (running) return;
  const engine = translator();
  if (!engine || articles.length === 0) return;
  const db = getDb();
  const cached = cachedTranslations(
    articles.map((a) => a.id),
    "fa",
    db,
  );
  const now = Date.now();
  const missing = articles
    .filter((a) => !cached.has(a.id) && a.headline)
    .filter((a) => now - (attempted.get(a.id) ?? 0) > RETRY_AFTER_MS)
    .slice(0, BATCH);
  if (missing.length === 0) return;

  running = true;
  void (async () => {
    try {
      const results = await Promise.all(
        missing.map(async (article) => {
          try {
            return { article, translated: await translateOne(article, engine) };
          } catch {
            // A failed call still counts as attempted: one provider outage must
            // not turn every news-tab open into a retry storm.
            return { article, translated: null };
          }
        }),
      );
      let stored = 0;
      for (const { article, translated } of results) {
        attempted.set(article.id, Date.now());
        if (!translated) continue;
        run(
          db,
          `INSERT INTO news_translations (article_id, lang, headline, description, provider, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(article_id, lang) DO UPDATE SET
             headline = excluded.headline,
             description = excluded.description,
             provider = excluded.provider,
             created_at = excluded.created_at`,
          [
            article.id,
            "fa",
            translated.headline,
            translated.description,
            engine.model,
            new Date().toISOString(),
          ],
        );
        stored += 1;
      }
      if (stored > 0) console.log(`[news] translated ${stored} article(s) to fa`);
    } catch (err) {
      // Never surface: the tab already rendered with the source language.
      console.error("[news] translation failed:", String(err));
    } finally {
      running = false;
    }
  })();
}
