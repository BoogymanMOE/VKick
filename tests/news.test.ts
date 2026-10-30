/**
 * Persian news: the cache overlay is the whole contract between ESPN's English
 * text and an RTL Persian tab. These pin the three states a card can be in —
 * an English read, a cached Persian translation, and a Persian request with no
 * translation yet (labelled "English", never faked).
 */
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import {
  cachedTranslations,
  translationConfigured,
  withTranslation,
} from "../server/news/translate.js";
import { run } from "../server/db/index.js";

function tempDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE news_translations (
      article_id  TEXT NOT NULL,
      lang        TEXT NOT NULL,
      headline    TEXT NOT NULL,
      description TEXT,
      provider    TEXT,
      created_at  TEXT NOT NULL,
      PRIMARY KEY (article_id, lang)
    );
  `);
  return db;
}

const article = (id: string, headline = "Arsenal win", description = "Two goals.") => ({
  id,
  headline,
  description,
});

function testOverlay(): void {
  const db = tempDb();
  try {
    run(
      db,
      `INSERT INTO news_translations (article_id, lang, headline, description, provider, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ["a1", "fa", "پیروزی آرسنال", "دو گل.", "test", "2026-10-30T00:00:00.000Z"],
    );

    // English asks for nothing: the payload is already what it wants.
    const en = withTranslation([article("a1")], "en", db);
    assert.equal(en[0]?.headline, "Arsenal win");
    assert.equal(en[0]?.translated, false, "no translation flag in English");

    // Persian with a cached row: the Persian text replaces the source.
    const fa = withTranslation([article("a1")], "fa", db);
    assert.equal(fa[0]?.headline, "پیروزی آرسنال");
    assert.equal(fa[0]?.description, "دو گل.");
    assert.equal(fa[0]?.translated, true);

    // Persian without a row: English text stays, explicitly marked.
    const missing = withTranslation([article("a2")], "fa", db);
    assert.equal(missing[0]?.headline, "Arsenal win", "untranslated text is not invented");
    assert.equal(missing[0]?.translated, false, "the card can say it is English");

    const cached = cachedTranslations(["a1", "a2"], "fa", db);
    assert.equal(cached.get("a1")?.headline, "پیروزی آرسنال");
    assert.equal(cached.has("a2"), false);
    assert.equal(cachedTranslations([], "fa", db).size, 0);
  } finally {
    db.close();
  }
}

function testConfiguredSwitch(): void {
  const url = process.env.NEWS_TRANSLATE_URL;
  const key = process.env.NEWS_TRANSLATE_API_KEY;
  try {
    delete process.env.NEWS_TRANSLATE_URL;
    delete process.env.NEWS_TRANSLATE_API_KEY;
    assert.equal(translationConfigured(), false, "no endpoint, no feature — and nothing faked");
    process.env.NEWS_TRANSLATE_URL = "https://example.invalid/v1/chat/completions";
    assert.equal(translationConfigured(), false, "a URL alone is not enough");
    process.env.NEWS_TRANSLATE_API_KEY = "test-key";
    assert.equal(translationConfigured(), true);
  } finally {
    if (url === undefined) delete process.env.NEWS_TRANSLATE_URL;
    else process.env.NEWS_TRANSLATE_URL = url;
    if (key === undefined) delete process.env.NEWS_TRANSLATE_API_KEY;
    else process.env.NEWS_TRANSLATE_API_KEY = key;
  }
}

export function runNewsTests(): void {
  testOverlay();
  testConfiguredSwitch();
  console.log("  news: Persian cache overlay, English fallback and the config switch OK");
}
