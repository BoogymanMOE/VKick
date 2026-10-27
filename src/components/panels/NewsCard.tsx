import { cx } from "../../lib/cx";
import { openInTelegram } from "../../lib/telegram";
import { useI18n } from "../../i18n/context";
import type { NewsArticle } from "../../types";

/**
 * Opens the article. Inside Telegram this goes through WebApp.openLink with
 * try_instant_view, so the piece opens in Telegram's own reader (Instant View)
 * when ESPN's page supports it and in Telegram's in-app browser when it
 * doesn't — the reader never gets ejected to the system browser, which inside
 * a Mini App means leaving the app entirely. Outside Telegram the SDK is absent
 * and this falls back to a plain new tab.
 */
function openArticle(url: string): void {
  if (openInTelegram(url)) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * The one news card, shared by the club page's News tab and the match page's.
 * An article with no web URL still renders — it just must not pretend to be a
 * link, so it stays a plain container with no click handler. A <button>, not an
 * <a>: the destination is a JS call (openLink), not a navigation, and an anchor
 * would both navigate and open the link.
 */
export function NewsCard({ article, locale }: { article: NewsArticle; locale?: string }) {
  const { t, dir } = useI18n();
  const dateFmt = new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const body = (
    <>
      {article.imageUrl ? (
        <img
          src={article.imageUrl}
          alt=""
          loading="lazy"
          className="mb-2 h-32 w-full rounded-lg object-cover"
        />
      ) : null}
      <h3 className="text-sm font-bold leading-snug text-ink">{article.headline}</h3>
      {article.description ? (
        <p className="mt-1 line-clamp-2 text-xs text-ink-2">{article.description}</p>
      ) : null}
      <p className="mt-2 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-3">
        <span>{article.published ? dateFmt.format(new Date(article.published)) : ""}</span>
        {article.byline ? <span>{t("team.news.byline", { name: article.byline })}</span> : null}
      </p>
      {article.webUrl ? (
        <p className="mt-1 text-[11px] font-bold text-volt">
          {t("team.news.readMore")} {dir === "rtl" ? "←" : "→"}
        </p>
      ) : null}
    </>
  );
  const className =
    "block rounded-card border border-line bg-surface p-3 transition-colors duration-[var(--t-fast)]";
  if (!article.webUrl) return <div className={className}>{body}</div>;
  const url = article.webUrl;
  return (
    <button
      type="button"
      onClick={() => openArticle(url)}
      className={cx(className, "w-full cursor-pointer text-start hover:bg-elevated")}
    >
      {body}
    </button>
  );
}
