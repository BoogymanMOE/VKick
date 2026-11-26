import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BottomSheet } from "./BottomSheet";
import { PlayerAvatar, SectionHeading, TeamBadge } from "./ui";
import { SearchIcon, CloseIcon } from "./icons";
import { useSearch } from "../hooks/useApi";
import { useI18n } from "../i18n/context";
import { competitionName } from "../lib/leagues";
import { teamFromApi } from "../lib/teams";
import { cx } from "../lib/cx";
import { useLocalState } from "../lib/useLocalState";
import { rememberSearch } from "../lib/recentSearches";
import { foldSearch, matchRanges } from "../lib/searchText";

/** Rows cascade in slightly after one another instead of popping as one block. */
const stagger = (index: number): CSSProperties =>
  ({ "--stagger": `${Math.min(index, 10) * 26}ms` }) as CSSProperties;

const rowClass =
  "flex min-h-12 items-center gap-2.5 rounded-card border px-3 transition-[background-color,border-color,transform] duration-[var(--t-fast)] hover:bg-elevated active:scale-[0.99]";

/** Bold the slice of a label that the typed query actually matched. */
function Highlight({ text, query }: { text: string; query: string }) {
  const ranges = matchRanges(text, query);
  if (ranges.length === 0) return <>{text}</>;

  const chars = Array.from(text);
  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach((range, index) => {
    if (range.start > cursor) parts.push(chars.slice(cursor, range.start).join(""));
    parts.push(
      <span key={index} className="font-extrabold text-volt">
        {chars.slice(range.start, range.end).join("")}
      </span>,
    );
    cursor = range.end;
  });
  if (cursor < chars.length) parts.push(chars.slice(cursor).join(""));
  return <>{parts}</>;
}

/**
 * One search field over everything the app knows: competitions, clubs and
 * players. Results are grouped and capped server-side (see /api/search), and
 * clubs are ranked by relevance before they arrive — one letter is enough to
 * surface Barcelona and Bayern ahead of the rest of the B's. The sheet stays
 * a quick jump surface rather than a second browse screen. A player opens
 * their club page — there is no per-player route — which is still the useful
 * destination (squad, fixtures, season stats).
 *
 * Keyboard: ↑/↓ walk the flattened result list (input keeps focus), Enter
 * opens the highlighted row. ARIA listbox roles are deliberately not faked on
 * links; the arrow keys are a shortcut, tab still reaches every result.
 */
export function SearchSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, lang, localize } = useI18n();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(-1);
  const [recent, setRecent] = useLocalState<string[]>("search.recent", []);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Reset between openings; a stale query from last time reads as a bug.
  useEffect(() => {
    if (!open) {
      setQuery("");
      setDebounced("");
      setActive(-1);
      return;
    }
    // BottomSheet moves focus to the dialog in its own effect; land it on the
    // field one tick later, or the sheet immediately steals the caret back.
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(query), 220);
    return () => window.clearTimeout(id);
  }, [query]);

  // A new query means the old highlight is meaningless until results land.
  useEffect(() => {
    setActive(-1);
  }, [debounced]);

  const search = useSearch(debounced);
  const data = search.data;
  const hasResults =
    Boolean(data) &&
    ((data?.teams.length ?? 0) > 0 ||
      (data?.players.length ?? 0) > 0 ||
      (data?.competitions.length ?? 0) > 0);
  // One character is enough for clubs; the server ranks them so the first
  // hit is the club people meant, not the first alphabetically.
  const ready = debounced.trim().length >= 1;

  // Every rendered result in visual order, so one index drives the arrows.
  const items = useMemo(() => {
    if (!data) return [];
    return [
      ...data.competitions.map((comp) => ({
        key: `c-${comp.slug}`,
        href: comp.kind === "league" ? `/matches?league=${comp.slug}` : `/cups?cup=${comp.slug}`,
      })),
      ...data.teams.map((team) => ({ key: `t-${team.id}`, href: `/team/${team.id}` })),
      ...data.players.map((player) => ({ key: `p-${player.id}`, href: `/team/${player.team_id}` })),
    ];
  }, [data]);

  // Keep the highlighted row inside the sheet's scroll view while arrowing.
  useEffect(() => {
    if (active < 0) return;
    document.getElementById(`search-opt-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Only a committed query counts: tapping a result or pressing Enter. Typing
  // a word and abandoning it would otherwise pollute the shortcut row.
  const remember = (value: string) => setRecent((prev) => rememberSearch(prev, value));
  const chooseResult = () => {
    remember(debounced);
    onClose();
  };
  const openHref = (href: string) => {
    remember(debounced);
    navigate(href);
    onClose();
  };
  const removeRecent = (term: string) =>
    setRecent((prev) => prev.filter((entry) => entry !== term));
  const runRecent = (term: string) => {
    setQuery(term);
    setDebounced(term);
    setActive(-1);
  };

  // While typing, only recents that could still be what is being typed are
  // offered; the full list belongs to the empty state.
  const typedFold = foldSearch(query);
  const visibleRecent = ready
    ? recent.filter((term) => foldSearch(term).includes(typedFold))
    : recent;

  const compCount = data?.competitions.length ?? 0;
  const playerOffset = compCount + (data?.teams.length ?? 0);
  // One of the two tones, never both: conflicting border/bg utilities rely on
  // generated-CSS order, not class order, so the pair is chosen outright.
  const rowTone = (index: number) =>
    active === index ? "border-volt bg-elevated" : "border-line bg-surface";

  const recentChips = (terms: string[]) => (
    <div className="flex flex-wrap gap-2">
      {terms.map((term, index) => (
        <span
          key={term}
          className="list-in inline-flex min-h-9 items-center rounded-full border border-line bg-surface ps-3 pe-1 transition-colors duration-[var(--t-fast)] hover:bg-elevated"
          style={stagger(index)}
        >
          <button
            type="button"
            onClick={() => runRecent(term)}
            className="min-h-9 pe-1 text-xs font-bold text-ink"
          >
            <Highlight text={term} query={query} />
          </button>
          <button
            type="button"
            onClick={() => removeRecent(term)}
            aria-label={t("search.removeRecent", { query: term })}
            className="grid h-7 w-7 place-items-center rounded-full text-ink-3 transition-colors hover:bg-elevated hover:text-ink"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </span>
      ))}
    </div>
  );

  return (
    <BottomSheet open={open} onClose={onClose} title={t("search.title")} subtitle={t("search.subtitle")}>
      <div className="relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 start-3 grid place-items-center text-ink-3"
        >
          <SearchIcon className="h-4 w-4" />
        </span>
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && items.length > 0) {
              event.preventDefault();
              setActive((prev) => (prev + 1) % items.length);
            } else if (event.key === "ArrowUp" && items.length > 0) {
              event.preventDefault();
              setActive((prev) => (prev <= 0 ? items.length - 1 : prev - 1));
            } else if (event.key === "Enter") {
              if (active >= 0 && items[active]) {
                event.preventDefault();
                openHref(items[active].href);
              } else {
                remember(query);
              }
            }
          }}
          placeholder={t("search.placeholder")}
          aria-label={t("search.placeholder")}
          className="search-field min-h-12 w-full rounded-card border border-line bg-surface ps-10 pe-10 text-sm font-bold text-ink placeholder:font-normal placeholder:text-ink-3 focus:border-volt focus:outline-none"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setActive(-1);
            }}
            aria-label={t("search.clear")}
            className="absolute inset-y-0 end-1 grid w-10 place-items-center text-ink-3 transition-[color,transform] duration-[var(--t-fast)] hover:rotate-90 hover:text-ink active:scale-90"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {/* In-flight indicator: the previous hits stay put, this only says the
          next set is on its way. */}
      {search.isFetching && hasResults ? (
        <div className="mt-2 h-0.5 overflow-hidden rounded-full bg-elevated" aria-hidden="true">
          <div className="search-progress h-full w-1/3 rounded-full bg-volt" />
        </div>
      ) : null}

      {!ready ? (
        <div className="mt-4">
          {recent.length > 0 ? (
            <>
              <SectionHeading
                title={t("search.recent")}
                action={
                  <button
                    type="button"
                    onClick={() => setRecent([])}
                    className="text-[11px] font-bold text-ink-3 transition-colors hover:text-ink"
                  >
                    {t("search.clearRecent")}
                  </button>
                }
              />
              {recentChips(recent)}
            </>
          ) : (
            <p className="text-center text-xs text-ink-3">{t("search.hint")}</p>
          )}
        </div>
      ) : search.isError ? (
        <p className="mt-4 text-center text-xs text-danger">{t("search.error")}</p>
      ) : search.isLoading && !data ? (
        <div className="mt-4 space-y-2">
          <div className="space-y-2" aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="shimmer h-12 rounded-card border border-line" />
            ))}
          </div>
          <p className="sr-only" role="status">
            {t("search.searching")}
          </p>
        </div>
      ) : !hasResults ? (
        <p className="mt-4 text-center text-xs text-ink-3">{t("search.empty", { query: debounced.trim() })}</p>
      ) : (
        <div className={cx("mt-4 space-y-5", search.isFetching && "opacity-80")}>
          {/* Matching recent searches stay within reach while typing, so a
              repeat search is one tap instead of the whole query again. */}
          {visibleRecent.length > 0 ? (
            <section>
              <SectionHeading title={t("search.recent")} />
              {recentChips(visibleRecent)}
            </section>
          ) : null}

          {data!.competitions.length > 0 ? (
            <section>
              <SectionHeading title={t("search.competitions")} />
              <ul className="space-y-1.5">
                {data!.competitions.map((comp, index) => (
                  <li key={comp.slug} className="list-in" style={stagger(index)}>
                    <Link
                      id={`search-opt-${index}`}
                      to={comp.kind === "league" ? `/matches?league=${comp.slug}` : `/cups?cup=${comp.slug}`}
                      onClick={chooseResult}
                      onMouseEnter={() => setActive(index)}
                      className={cx(
                        "flex min-h-11 items-center gap-2 rounded-card border px-3 text-sm font-bold text-ink transition-[background-color,border-color,transform] duration-[var(--t-fast)] hover:bg-elevated active:scale-[0.99]",
                        rowTone(index),
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <Highlight
                          text={competitionName(comp.slug, lang) || localize(comp.name)}
                          query={debounced}
                        />
                      </span>
                      <span className="flex-none text-[10px] font-bold uppercase tracking-wide text-ink-3">
                        {t(comp.kind === "league" ? "browse.leagues" : comp.kind === "cup" ? "browse.cups" : "browse.tournaments")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {data!.teams.length > 0 ? (
            <section>
              <SectionHeading title={t("search.teams")} />
              <ul className="space-y-1.5">
                {data!.teams.map((team, index) => {
                  const flat = compCount + index;
                  return (
                    <li key={team.id} className="list-in" style={stagger(index)}>
                      <Link
                        id={`search-opt-${flat}`}
                        to={`/team/${team.id}`}
                        onClick={chooseResult}
                        onMouseEnter={() => setActive(flat)}
                        className={cx(rowClass, rowTone(flat))}
                      >
                        <TeamBadge team={teamFromApi(team)} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-ink">
                            <Highlight text={localize(team.name)} query={debounced} />
                          </span>
                          {/* Why a nickname hit landed here: "barca" below
                              Barcelona, so the result never looks accidental. */}
                          {team.matched ? (
                            <span className="block truncate text-[10px] font-bold text-ink-3">
                              <Highlight text={team.matched} query={debounced} />
                            </span>
                          ) : null}
                        </span>
                        <span className="flex-none text-[10px] font-bold uppercase tracking-wide text-ink-3">
                          {competitionName(team.league, lang)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {data!.players.length > 0 ? (
            <section>
              <SectionHeading title={t("search.players")} />
              <ul className="space-y-1.5">
                {data!.players.map((player, index) => {
                  const flat = playerOffset + index;
                  return (
                    <li key={player.id} className="list-in" style={stagger(index)}>
                      <Link
                        id={`search-opt-${flat}`}
                        to={`/team/${player.team_id}`}
                        onClick={chooseResult}
                        onMouseEnter={() => setActive(flat)}
                        className={cx(rowClass, rowTone(flat))}
                      >
                        <PlayerAvatar
                          name={player.name}
                          src={player.headshot_url}
                          teamColor={player.team_color}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-bold text-ink">
                            <Highlight text={player.name} query={debounced} />
                          </span>
                          <span className="block truncate text-[11px] text-ink-3">
                            <Highlight text={localize(player.team_name)} query={debounced} />
                            {player.position ? ` · ${player.position}` : ""}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </BottomSheet>
  );
}
