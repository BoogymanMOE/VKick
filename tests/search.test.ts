/**
 * Search matching: nicknames must find the club, accents and punctuation must
 * not matter (the app's data is full of both), and ranking must put the club
 * people meant above incidental substring hits.
 */
import { strict as assert } from "node:assert";
import { rankCompetitions, rankTeams } from "../server/search/aliases.js";
import { MAX_RECENT_SEARCHES, rememberSearch } from "../src/lib/recentSearches.js";
import { foldSearch, matchRanges } from "../src/lib/searchText.js";

type Row = { id: string; name: string; short_name: string; abbreviation: string };

const teams: Row[] = [
  { id: "83", name: "Barcelona", short_name: "Barcelona", abbreviation: "BAR" },
  { id: "1068", name: "Atlético Madrid", short_name: "Atlético", abbreviation: "ATM" },
  { id: "86", name: "Real Madrid", short_name: "Real Madrid", abbreviation: "RMA" },
  { id: "360", name: "Manchester United", short_name: "Man Utd", abbreviation: "MAN" },
  { id: "382", name: "Manchester City", short_name: "Man City", abbreviation: "MNC" },
  { id: "364", name: "Liverpool", short_name: "Liverpool", abbreviation: "LIV" },
  { id: "367", name: "Tottenham Hotspur", short_name: "Spurs", abbreviation: "TOT" },
  { id: "111", name: "Juventus", short_name: "Juventus", abbreviation: "JUV" },
  { id: "110", name: "Internazionale", short_name: "Inter Milan", abbreviation: "INT" },
  { id: "114", name: "Napoli", short_name: "Napoli", abbreviation: "NAP" },
  { id: "115", name: "Espanyol", short_name: "Espanyol", abbreviation: "ESP" },
  { id: "132", name: "Paris Saint-Germain", short_name: "PSG", abbreviation: "PSG" },
  { id: "157", name: "Bayern Munich", short_name: "Bayern", abbreviation: "MUN" },
  { id: "124", name: "FC Cologne", short_name: "Cologne", abbreviation: "KOE" },
  { id: "268", name: "Málaga", short_name: "Málaga", abbreviation: "MCF" },
  { id: "1898", name: "Beşiktaş", short_name: "Besiktas", abbreviation: "BES" },
  { id: "10514", name: "Bodo/Glimt", short_name: "Bodo/Glimt", abbreviation: "BODO" },
  { id: "175", name: "Le Mans", short_name: "Le Mans", abbreviation: "MNS" },
  { id: "999", name: "Barcelona SC", short_name: "Barcelona SC", abbreviation: "BSC" },
];

const top = (query: string) => rankTeams(teams, query)[0]?.name;
const ids = (query: string) => rankTeams(teams, query).map((team) => team.id);

const competitions = [
  { slug: "eng.1", name: "Premier League" },
  { slug: "esp.1", name: "La Liga" },
  { slug: "ita.1", name: "Serie A" },
  { slug: "ger.1", name: "Bundesliga" },
  { slug: "fra.1", name: "Ligue 1" },
  { slug: "uefa.champions", name: "UEFA Champions League" },
  { slug: "uefa.europa", name: "UEFA Europa League" },
];

export function runSearchTests(): void {
  // Nicknames resolve to the club people meant, not a namesake elsewhere.
  assert.equal(top("barca"), "Barcelona", "barca → Barcelona");
  assert.equal(top("BARCA"), "Barcelona", "nicknames are case-insensitive");
  assert.equal(top("بارسا"), "Barcelona", "Persian nickname resolves");
  assert.equal(top("man utd"), "Manchester United");
  assert.equal(top("man united"), "Manchester United");
  assert.equal(top("mufc"), "Manchester United");
  assert.equal(top("spurs"), "Tottenham Hotspur");
  assert.equal(top("juve"), "Juventus");
  assert.equal(top("psg"), "Paris Saint-Germain");
  assert.equal(top("inter"), "Internazionale");
  assert.equal(top("napoli"), "Napoli");
  assert.equal(top("ناپولی"), "Napoli");
  assert.equal(top("منچستر یونایتد"), "Manchester United");

  // Accents, punctuation and the accented official name are all folded away.
  assert.equal(top("atletico"), "Atlético Madrid");
  assert.equal(top("atlético"), "Atlético Madrid");
  assert.equal(top("malaga"), "Málaga");
  assert.equal(top("besiktas"), "Beşiktaş");
  assert.equal(top("bodo/glimt"), "Bodo/Glimt");
  assert.equal(top("bodo glimt"), "Bodo/Glimt");
  assert.equal(top("koln"), "FC Cologne");
  assert.equal(top("bayern munchen"), "Bayern Munich");

  // Prefix matching keeps working while the nickname is still being typed.
  assert.equal(top("man u"), "Manchester United", "typed prefix man u");
  assert.ok(!ids("man u").includes("175"), "token matching does not leak Le Mans into man u");
  assert.equal(top("barc"), "Barcelona", "typed prefix barc");
  // One typo is still the club: substitution, missing/extra letter, and an
  // adjacent swap all resolve, but a word that only looks similar does not.
  assert.equal(top("barcalona"), "Barcelona", "substitution typo");
  assert.ok(!ids("barcalona").includes("115"), "nickname words are not fuzzy-matched");
  assert.equal(top("barcleona"), "Barcelona", "adjacent transposition");
  assert.equal(top("barcelono"), "Barcelona", "wrong letter");
  assert.equal(top("bayren"), "Bayern Munich");
  assert.equal(top("manchster"), "Manchester United");
  assert.equal(top("liverpol"), "Liverpool", "missing letter");
  assert.equal(top("juventis"), "Juventus");
  assert.deepEqual(ids("zzz"), [], "unknown query returns nothing");
  assert.deepEqual(ids("zzzzz"), [], "unrelated word does not fuzzy-match");

  // A single letter is enough for clubs, and the marquee list decides the
  // order: Barcelona and Bayern before the rest of the B's, United before City.
  assert.deepEqual(ids("b").slice(0, 2), ["83", "157"], "b → Barcelona, Bayern first");
  assert.equal(top("r"), "Real Madrid");
  assert.equal(top("man"), "Manchester United", "marquee tie-break beats alphabetical");
  assert.deepEqual(ids(""), [], "empty query returns nothing");

  assert.equal(rankTeams(teams, "manchester").length, 2, "both Manchester clubs");
  assert.equal(top("sky blues"), "Manchester City");
  assert.deepEqual(ids("rma"), ["86"], "exact abbreviation does not drag in Parma/PSG");
  assert.equal(top("utd"), "Manchester United", "short abbreviation still resolves");

  // Competitions understand their nicknames too.
  assert.equal(rankCompetitions(competitions, "ucl")[0]?.slug, "uefa.champions");
  assert.equal(rankCompetitions(competitions, "champions league")[0]?.slug, "uefa.champions");
  assert.equal(rankCompetitions(competitions, "uel")[0]?.slug, "uefa.europa");
  assert.equal(rankCompetitions(competitions, "epl")[0]?.slug, "eng.1");
  assert.equal(rankCompetitions(competitions, "serie a")[0]?.slug, "ita.1");
  assert.deepEqual(rankCompetitions(competitions, "zzz"), []);

  // Recent searches: newest first, case-insensitive de-dupe, capped.
  let recent = rememberSearch([], "Barcelona");
  assert.deepEqual(recent, ["Barcelona"]);
  recent = rememberSearch(recent, "barcelona");
  assert.deepEqual(recent, ["barcelona"], "same query keeps one entry, newest casing wins");
  recent = rememberSearch(recent, "Real Madrid");
  assert.deepEqual(recent, ["Real Madrid", "barcelona"]);
  assert.equal(rememberSearch(recent, "a"), recent, "below the two-character floor is not stored");
  for (let i = 0; i < MAX_RECENT_SEARCHES + 3; i += 1) recent = rememberSearch(recent, `q${i}`);
  assert.equal(recent.length, MAX_RECENT_SEARCHES, "recent list is capped");
  assert.equal(recent[0], `q${MAX_RECENT_SEARCHES + 2}`, "newest search leads");

  // Highlighting: accent- and case-insensitive, code-point indexed, and
  // overlapping hits on the same word merge into one range.
  assert.equal(foldSearch("  Atlético  "), "atletico");
  assert.deepEqual(matchRanges("Barcelona", "barc"), [{ start: 0, end: 4 }]);
  assert.deepEqual(matchRanges("Atlético Madrid", "atletico"), [{ start: 0, end: 8 }]);
  assert.deepEqual(matchRanges("Málaga", "MALAGA"), [{ start: 0, end: 6 }]);
  assert.deepEqual(matchRanges("منچستر یونایتد", "منچستر"), [{ start: 0, end: 6 }]);
  assert.deepEqual(matchRanges("Barcelona", "spurs"), [], "no match highlights nothing");
  assert.deepEqual(matchRanges("Barcelona", "barce barcel"), [{ start: 0, end: 6 }], "overlaps merge");
  assert.deepEqual(matchRanges("Real Madrid", ""), []);
}
