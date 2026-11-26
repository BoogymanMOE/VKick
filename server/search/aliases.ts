/**
 * Search aliases and ranking for the global search box.
 *
 * The teams table only knows ESPN's official names, which is a poor match for
 * how people actually search: "barca", "man utd", "spurs", "juve", "بارسا"
 * or an unaccented "atletico" all used to return nothing. Each entry below is
 * the club's stored name followed by the names people use for it, in English
 * and Persian (the app's third language, so the same search works in RTL).
 *
 * Matching is folded — case, accents and punctuation are ignored — so
 * "malaga" finds Málaga without needing a separate alias, and "besiktas"
 * finds Beşiktaş. Results are ranked rather than merely filtered: an exact
 * name beats a nickname, which beats a partial word, which beats a loose
 * substring. `rankTeams` and `rankCompetitions` are pure so the test suite can
 * pin the ordering without a database.
 */
export interface SearchableTeam {
  name: string;
  short_name?: string | null;
  abbreviation?: string | null;
}

/** Stored club name first, then the aliases people type for it. */
const CLUB_ALIASES: readonly (readonly string[])[] = [
  // ---------------------------------------------------------------- England
  ["AFC Bournemouth", "bournemouth", "cherries"],
  ["Arsenal", "arsenal fc", "gunners", "آرسنال"],
  ["Aston Villa", "villa", "villans", "aston villa fc"],
  ["Brentford", "bees", "brentford fc"],
  ["Brighton & Hove Albion", "brighton", "seagulls", "albion"],
  ["Chelsea", "chelsea fc", "blues", "چلسی"],
  ["Coventry City", "coventry", "sky blues"],
  ["Crystal Palace", "palace", "eagles"],
  ["Everton", "everton fc", "toffees"],
  ["Fulham", "fulham fc", "cottagers"],
  ["Hull City", "hull", "tigers"],
  ["Ipswich Town", "ipswich", "tractor boys"],
  ["Leeds United", "leeds", "elland road"],
  ["Liverpool", "liverpool fc", "lfc", "reds", "لیورپول"],
  [
    "Manchester City",
    "man city",
    "manchester city",
    "mcfc",
    "sky blues",
    "citizens",
    "منچستر سیتی",
    "من سیتی",
  ],
  [
    "Manchester United",
    "man utd",
    "man united",
    "manchester utd",
    "mufc",
    "red devils",
    "منچستر یونایتد",
    "من یونایتد",
  ],
  ["Newcastle United", "newcastle", "toon", "magpies", "نیوکاسل"],
  ["Nottingham Forest", "forest", "nottm forest", "tricky trees"],
  ["Sunderland", "sunderland afc", "black cats"],
  ["Tottenham Hotspur", "tottenham", "spurs", "lilywhites", "تاتنهام"],
  // ------------------------------------------------------------------- Spain
  ["Alavés", "alaves", "babazorros"],
  ["Athletic Club", "athletic", "athletic bilbao", "bilbao", "lions"],
  [
    "Atlético Madrid",
    "atletico",
    "atleti",
    "atletico madrid",
    "colchoneros",
    "rojiblancos",
    "اتلتیکو مادرید",
    "اتلتیکو",
  ],
  [
    "Barcelona",
    "barca",
    "barça",
    "barcelona fc",
    "blaugrana",
    "cules",
    "culers",
    "بارسلونا",
    "بارسا",
  ],
  ["Celta Vigo", "celta", "celticos"],
  ["Deportivo", "deportivo la coruna", "depor"],
  ["Elche", "elche cf", "franjiverdes"],
  ["Espanyol", "espanyol barcelona", "periquitos"],
  ["Getafe", "getafe cf", "azulones"],
  ["Levante", "levante ud", "granotes"],
  ["Málaga", "malaga", "boquerones"],
  ["Osasuna", "osasuna", "rojillos"],
  ["Racing Santander", "racing", "racing de santander"],
  ["Rayo Vallecano", "rayo", "franjirrojos"],
  ["Real Betis", "betis", "verdiblancos", "beticos"],
  ["Real Madrid", "real madrid cf", "blancos", "merengues", "madridistas", "رئال مادرید", "رئال"],
  ["Real Sociedad", "sociedad", "la real", "txuri urdin"],
  ["Sevilla", "sevilla fc", "nervionenses", "sevillistas", "سویا"],
  ["Valencia", "valencia cf", "che", "ches", "والنسیا"],
  ["Villarreal", "villarreal cf", "yellow submarine", "submarino amarillo"],
  // ----------------------------------------------------------------- Germany
  ["1. FC Union Berlin", "union berlin", "union", "eisern"],
  ["Bayer Leverkusen", "leverkusen", "bayer", "werkself"],
  ["Bayern Munich", "bayern", "fc bayern", "bayern munchen", "munich", "بایرن مونیخ", "بایرن"],
  ["Borussia Dortmund", "dortmund", "bvb", "black yellows", "دورتموند"],
  ["Borussia Mönchengladbach", "gladbach", "monchengladbach", "fohlen"],
  ["Eintracht Frankfurt", "frankfurt", "eintracht", "sge"],
  ["FC Augsburg", "augsburg", "fca"],
  ["FC Cologne", "cologne", "koln", "1 fc koln", "effzeh"],
  ["Hamburg SV", "hamburg", "hsv"],
  ["Mainz", "mainz 05", "mainz"],
  ["RB Leipzig", "leipzig", "rb", "rbl"],
  ["SC Freiburg", "freiburg", "scf"],
  ["SC Paderborn 07", "paderborn", "scp"],
  ["SV Elversberg", "elversberg"],
  ["Schalke 04", "schalke", "s04"],
  ["TSG Hoffenheim", "hoffenheim", "tsg"],
  ["VfB Stuttgart", "stuttgart", "vfb"],
  ["Werder Bremen", "werder", "bremen", "sv werder"],
  // ------------------------------------------------------------------- Italy
  ["AC Milan", "milan", "ac milan", "rossoneri", "آث میلان", "میلان"],
  ["AS Roma", "roma", "as roma", "giallorossi", "lupi"],
  ["Atalanta", "atalanta", "la dea"],
  ["Bologna", "bologna", "rossoblu"],
  ["Cagliari", "cagliari", "islanders"],
  ["Como", "como 1907"],
  ["Fiorentina", "fiorentina", "viola", "la viola"],
  ["Frosinone", "frosinone", "canarini"],
  ["Genoa", "genoa", "grifone"],
  ["Internazionale", "inter", "inter milan", "nerazzurri", "اینتر", "اینتر میلان"],
  ["Juventus", "juve", "bianconeri", "old lady", "یوونتوس", "یووه"],
  ["Lazio", "lazio", "biancocelesti"],
  ["Lecce", "lecce", "salentini"],
  ["Monza", "monza", "brianzoli"],
  ["Napoli", "napoli", "naples", "partenopei", "ناپولی"],
  ["Parma", "parma", "crociati"],
  ["Sassuolo", "sassuolo", "neroverdi"],
  ["Torino", "torino", "toro", "granata"],
  ["Udinese", "udinese", "zebrette"],
  ["Venezia", "venezia", "arancioneroverdi"],
  // ------------------------------------------------------------------ France
  ["AJ Auxerre", "auxerre", "aja"],
  ["AS Monaco", "monaco", "asm"],
  ["Angers", "angers", "sco"],
  ["Brest", "brest", "sb29"],
  ["Le Havre AC", "le havre", "hac"],
  ["Le Mans", "le mans", "muc"],
  ["Lens", "lens", "rcl"],
  ["Lille", "lille", "losc"],
  ["Lorient", "lorient", "fcl"],
  ["Lyon", "lyon", "olympique lyonnais", "ol", "لیون"],
  ["Marseille", "marseille", "olympique marseille", "om", "مارسی"],
  ["Nice", "nice", "ogcn"],
  ["Paris FC", "paris fc", "pfc"],
  [
    "Paris Saint-Germain",
    "paris saint germain",
    "psg",
    "paris sg",
    "paris",
    "پاری سن ژرمن",
    "پاریس",
  ],
  ["Stade Rennais", "rennes", "stade rennais", "srfc"],
  ["Strasbourg", "strasbourg", "rcsa"],
  ["Toulouse", "toulouse", "tfc"],
  ["Troyes", "troyes", "estac"],
  // ---------------------------------------------- Rest of Europe (UEFA cups)
  ["AEK Athens", "aek", "aek athens fc"],
  ["AZ Alkmaar", "az", "alkmaar"],
  ["Anderlecht", "rsc anderlecht", "anderlecht"],
  ["Benfica", "sl benfica", "benfica lisbon", "بنفیکا"],
  ["Besiktas", "beşiktaş", "bjk"],
  ["Bodo/Glimt", "bodo glimt", "bodø/glimt"],
  ["Braga", "sc braga", "sporting braga"],
  ["Celtic", "celtic fc", "bhoys", "سلتیک"],
  ["Club Brugge", "brugge", "club brugge kv"],
  ["Dinamo Zagreb", "dinamo", "gnk dinamo"],
  ["F.C. København", "copenhagen", "kobenhavn", "fc copenhagen", "kbh"],
  ["FC Nordsjælland", "nordsjaelland", "nordsjælland"],
  ["FC Porto", "porto", "fcp", "پورتو"],
  ["FC Thun", "thun"],
  ["FC Twente", "twente"],
  ["Fenerbahce", "fenerbahçe", "fener", "فنرباغچه"],
  ["Ferencvaros", "ferencváros", "ftc"],
  ["Feyenoord Rotterdam", "feyenoord", "feyenoord rotterdam"],
  ["Galatasaray", "gala", "galatasaray sk", "گالاتاسرای"],
  ["Heart of Midlothian", "hearts", "hearts of midlothian"],
  ["Hapoel Be'er", "hapoel beer sheva", "hapoel"],
  ["Jablonec", "fk jablonec"],
  ["Jagiellonia Bialystok", "jagiellonia", "bialystok"],
  ["Kauno Zalgiris", "zalgiris", "kauno zalgiris"],
  ["LASK Linz", "lask", "linz"],
  ["Lech Poznan", "lech", "poznan"],
  ["Levski Sofia", "levski", "sofia"],
  ["Lillestrom", "lsk", "lillestrøm"],
  ["NEC Nijmegen", "nec", "nijmegen"],
  ["NK Celje", "celje"],
  ["OFI Crete", "ofi", "crete"],
  ["Olympiacos", "olympiakos", "olympiacos fc"],
  ["Omonia Nicosia", "omonia", "nicosia"],
  ["Pafos", "pafos fc"],
  ["PSV Eindhoven", "psv", "eindhoven"],
  ["RB Salzburg", "salzburg", "red bull salzburg"],
  ["Sabah FK", "sabah"],
  ["Shakhtar Donetsk", "shakhtar", "shakhtar donetsk"],
  ["SK Sturm Graz", "sturm graz", "sturm"],
  ["Slavia Prague", "slavia", "slavia praha"],
  ["Slovan Bratislava", "slovan", "bratislava"],
  ["Sparta Prague", "sparta", "sparta praha"],
  ["Sporting CP", "sporting", "sporting lisbon", "sporting portugal", "اسپورتینگ"],
  ["Torreense", "torreense"],
  ["Union St.-Gilloise", "union sg", "union saint gilloise", "usg"],
  ["Viktoria Plzen", "plzen", "viktoria plzen"],
  ["Viking FK", "viking", "stavanger"],
  // Clubs without a domestic row this season but common in European search.
  ["Ajax", "afc ajax", "آژاکس"],
  ["Red Star Belgrade", "red star", "crvena zvezda"],
  ["Dynamo Kyiv", "dynamo kyiv", "dynamo kiev", "dynamo"],
  ["Rangers", "glasgow rangers"],
];

/** Competition nicknames; the catalog's own name and slug still match too. */
const COMPETITION_ALIASES: Record<string, readonly string[]> = {
  "eng.1": ["premier league", "epl", "bpl", "the prem", "لیگ برتر انگلیس"],
  "esp.1": ["la liga", "laliga", "primera division", "لالیگا"],
  "ita.1": ["serie a", "calcio", "سری آ"],
  "ger.1": ["bundesliga", "بوندس‌لیگا"],
  "fra.1": ["ligue 1", "l1", "لیگ ۱ فرانسه"],
  "uefa.champions": ["champions league", "ucl", "european cup", "champions", "لیگ قهرمانان"],
  "uefa.europa": ["europa league", "uel", "europa", "لیگ اروپا"],
};

/** Clubs answer from the first letter; players/competitions need two. */
const MIN_CLUB_QUERY = 1;

/**
 * The clubs people mean first. Used only to break ties between equally good
 * matches, so a one-letter query surfaces Barcelona and Bayern before
 * Bournemouth and Braga, and "manchester" puts United above City.
 */
const MARQUEE_CLUBS: readonly string[] = [
  "Real Madrid",
  "Barcelona",
  "Manchester United",
  "Manchester City",
  "Liverpool",
  "Arsenal",
  "Chelsea",
  "Bayern Munich",
  "Paris Saint-Germain",
  "Juventus",
  "AC Milan",
  "Internazionale",
  "Borussia Dortmund",
  "Atlético Madrid",
  "Tottenham Hotspur",
  "Newcastle United",
  "Napoli",
  "AS Roma",
  "Ajax",
  "Benfica",
  "FC Porto",
  "Celtic",
  "Galatasaray",
  "Fenerbahce",
  "Sevilla",
  "Valencia",
  "Villarreal",
  "Bayer Leverkusen",
  "RB Leipzig",
  "Aston Villa",
  "West Ham United",
  "Everton",
  "Marseille",
  "Lyon",
  "AS Monaco",
  "Lille",
  "Sporting CP",
  "PSV Eindhoven",
  "Feyenoord Rotterdam",
  "Club Brugge",
  "Anderlecht",
  "Olympiacos",
  "Besiktas",
  "Shakhtar Donetsk",
  "RB Salzburg",
  "Dinamo Zagreb",
  "Sparta Prague",
  "Slavia Prague",
];

/**
 * Case-, accent- and punctuation-insensitive form used on BOTH sides of every
 * comparison. NFD splits accented letters so the combining marks can be
 * dropped ("Atlético" → "atletico"), Arabic yeh/kaf fold to their Persian
 * counterparts so an Arabic keyboard still matches Persian aliases, and
 * punctuation becomes a space so "St.-Gilloise" and "Bodo/Glimt" line up with
 * how people type them.
 */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[\u064a\u0649]/g, "\u06cc")
    .replace(/\u0643/g, "\u06a9")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/* * Folded alias → its whole group, so a club can find its nicknames by name.
 */
const GROUP_BY_NAME = new Map<string, readonly string[]>();
for (const group of CLUB_ALIASES) {
  for (const name of group) GROUP_BY_NAME.set(fold(name), group);
}

/** Folded marquee name → its rank. Anything unlisted sorts after all of them. */
const POPULARITY = new Map<string, number>(MARQUEE_CLUBS.map((name, index) => [fold(name), index]));

function popularityOf(teamName: string): number {
  return POPULARITY.get(fold(teamName)) ?? MARQUEE_CLUBS.length;
}

function aliasesFor(team: SearchableTeam): string[] {
  const group =
    GROUP_BY_NAME.get(fold(team.name)) ??
    (team.short_name ? GROUP_BY_NAME.get(fold(team.short_name)) : undefined);
  return group ? [...group] : [];
}

/** True when `needle` starts the whole string or any word in it. */
function startsWord(haystack: string, needle: string): boolean {
  return haystack.startsWith(needle) || haystack.includes(` ${needle}`);
}

/** Typos are only corrected on words long enough for one edit to be a typo. */
const MIN_TYPO_WORD = 5;

/**
 * True when `a` and `b` are at most one edit apart: insertion, deletion,
 * substitution, or a swapped adjacent pair ("barcleona" → "barcelona").
 * The transposition case is what plain Levenshtein misses, and it is the
 * most common typing slip of all.
 */
function isOneEditApart(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;

  if (a.length === b.length) {
    let first = -1;
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] === b[i]) continue;
      if (first === -1) {
        first = i;
        continue;
      }
      // A second difference is only allowed as a swap of the two positions.
      return (
        i === first + 1 && a[first] === b[i] && a[i] === b[first] && a.slice(i + 1) === b.slice(i + 1)
      );
    }
    return first !== -1;
  }

  // One insertion/deletion: walk both strings allowing exactly one skip.
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let skipped = false;
  while (i < short.length && j < long.length) {
    if (short[i] === long[j]) {
      i += 1;
      j += 1;
      continue;
    }
    if (skipped) return false;
    skipped = true;
    j += 1;
  }
  return true;
}

/**
 * Fuzzy fallback: every query word must be a word-prefix of some club word, or
 * one typo away from one. Short words only get the prefix treatment, so "psg"
 * is never nudged into an unrelated three-letter word.
 */
function fuzzyMatches(words: readonly string[], tokens: readonly string[]): boolean {
  return tokens.every((token) =>
    words.some(
      (word) =>
        word.startsWith(token) ||
        (token.length >= MIN_TYPO_WORD &&
          word.length >= MIN_TYPO_WORD &&
          isOneEditApart(token, word)),
    ),
  );
}

/**
 * Ranked club matches. Every team is scored against its official name, short
 * name, abbreviation and alias group; the best tier wins. Lower is better:
 *
 *   0 exact name / short name / abbreviation ("barcelona", "man utd", "rma")
 *   1 name word start ("man" → Manchester City, Manchester United)
 *   2 exact nickname ("barca", "spurs", "juve", "بارسا")
 *   3 nickname prefix while it is being typed ("barc", "man u")
 *   4 name substring ("leti" → Atlético; needs 4+ characters, or "rma"
 *     would drag in Parma and PSG through "germain")
 *   5 nickname substring (same 4+ character floor)
 *   6 every query word starts a word in the club's names/nicknames
 *   7 one typo away from an official-name word ("barcalona", "bayren"),
 *     or a multi-word query whose short words prefix-match and long words
 *     are one typo off. Nicknames are deliberately excluded: one typo inside
 *     "espanyol barcelona" should not surface Espanyol for "barcalona"
 *
 * Ties go to the marquee list (Barcelona/Bayern before Bournemouth/Braga),
 * then alphabetically, so the same query always returns the same order.
 */
export function rankTeams<T extends SearchableTeam>(
  teams: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const needle = fold(query);
  if (needle.length < MIN_CLUB_QUERY) return [];
  const tokens = needle.split(" ").filter(Boolean);

  const scored: Array<{ team: T; score: number; key: string }> = [];
  for (const team of teams) {
    const name = fold(team.name);
    const short = fold(team.short_name ?? "");
    const abbr = fold(team.abbreviation ?? "");
    const aliases = aliasesFor(team).map(fold);
    // Token matching is word-start based, not substring: otherwise "man u"
    // found Le Mans and Manchester City through stray letters.
    const words = [name, short, abbr, ...aliases]
      .join(" ")
      .split(" ")
      .filter(Boolean);
    // Typos only correct the official/short name, never a nickname: a typo in
    // "espanyol barcelona" must not turn a Barcelona search into Espanyol.
    const nameWords = [name, short].join(" ").split(" ").filter(Boolean);

    let score: number | null = null;
    if (name === needle || short === needle || abbr === needle) {
      score = 0;
    } else if (startsWord(name, needle) || startsWord(short, needle) || abbr.startsWith(needle)) {
      score = 1;
    } else if (aliases.includes(needle)) {
      score = 2;
    } else if (aliases.some((alias) => startsWord(alias, needle))) {
      score = 3;
    } else if (
      needle.length >= 4 &&
      (name.includes(needle) || short.includes(needle) || abbr.includes(needle))
    ) {
      score = 4;
    } else if (needle.length >= 4 && aliases.some((alias) => alias.includes(needle))) {
      score = 5;
    } else if (
      tokens.length > 1 &&
      tokens.every((token) => words.some((word) => word.startsWith(token)))
    ) {
      score = 6;
    } else if (fuzzyMatches(nameWords, tokens)) {
      score = 7;
    }

    if (score !== null) scored.push({ team, score, key: name });
  }

  scored.sort(
    (a, b) =>
      a.score - b.score ||
      popularityOf(a.team.name) - popularityOf(b.team.name) ||
      a.key.localeCompare(b.key),
  );
  return scored.slice(0, limit).map((entry) => entry.team);
}

/**
 * The nickname a query reached a club through, for the result caption ("barca"
 * under Barcelona). Null when the visible name already contains the query, or
 * when the hit is a typo — there is nothing honest to show in either case.
 */
export function matchedAlias(team: SearchableTeam, query: string): string | null {
  const needle = fold(query);
  if (needle.length < 2) return null;
  const name = fold(team.name);
  if (name.includes(needle)) return null;
  const hit = aliasesFor(team).find((alias) => {
    const folded = fold(alias);
    return folded === needle || startsWord(folded, needle);
  });
  return hit && fold(hit) !== name ? hit : null;
}

/**
 * Competition matches: nickname exact first, then slug/name substrings. Kept
 * separate from clubs because a competition has no abbreviation column.
 */
export function rankCompetitions<T extends { slug: string; name: string }>(
  competitions: readonly T[],
  query: string,
  limit = 5,
): T[] {
  const needle = fold(query);
  if (needle.length < 2) return [];

  const scored: Array<{ competition: T; score: number }> = [];
  for (const competition of competitions) {
    const name = fold(competition.name);
    const slug = fold(competition.slug);
    const aliases = (COMPETITION_ALIASES[competition.slug] ?? []).map(fold);

    let score: number | null = null;
    if (aliases.includes(needle)) score = 0;
    else if (aliases.some((alias) => startsWord(alias, needle))) score = 1;
    else if (name === needle || name.includes(needle) || slug.includes(needle)) score = 2;
    else if (aliases.some((alias) => alias.includes(needle))) score = 3;
    if (score !== null) scored.push({ competition, score });
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((entry) => entry.competition);
}
