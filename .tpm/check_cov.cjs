const raw = require("fs").readFileSync(process.argv[2] || "/tmp/matches.txt", "utf8");
const data = JSON.parse(raw);

// teamNamesFa as defined in src/i18n/names.ts (covers big five leagues)
const teamNamesFa = {
  "Arsenal": "آرسنال",
  "Manchester City": "منچستر سیتی",
  "Liverpool": "لیورپول",
  "Chelsea": "چلسی",
  "Tottenham Hotspur": "تاتنهام",
  "Manchester United": "منچستر یونایتد",
  "Newcastle United": "نیوکاسل",
  "Aston Villa": "استون ویلا",
  "AFC Bournemouth": "بورن‌موت",
  "Brentford": "برنتفورد",
  "Brighton & Hove Albion": "برایتن",
  "Coventry City": "کاونتری",
  "Crystal Palace": "کریستال پالاس",
  "Everton": "ایورتون",
  "Fulham": "فولهم",
  "Hull City": "هال",
  "Ipswich Town": "ایپ‌سویچ",
  "Leeds United": "لیدز",
  "Nottingham Forest": "ناتینگهام فورست",
  "Sunderland": "سندرلند",
  "Man City": "منچستر سیتی",
  "Spurs": "تاتنهام",
  "Man United": "منچستر یونایتد",
  "Newcastle": "نیوکاسل",
  "Villa": "استون ویلا",
  "Bournemouth": "بورن‌موت",
  "Brighton": "برایتن",
  "C Palace": "کریستال پالاس",
  "Coventry": "کاونتری",
  "Hull": "هال",
  "Ipswich": "ایپ‌سویچ",
  "Leeds": "لیدز",
  "Nottm Forest": "ناتینگهام فورست",
  "Unknown": "نامشخص",
  "Real Madrid": "رئال مادرید",
  "Barcelona": "بارسلونا",
  "Atletico Madrid": "اتلتیکو مادرید",
  "Atletico": "اتلتیکو",
  "Sevilla": "سویا",
  "Valencia": "والنسیا",
  "Villarreal": "ویارئال",
  "Alaves": "آلاوِس",
  "Athletic Club": "اتلتیک کلوب",
  "Athletic": "اتلتیک",
  "Celta Vigo": "سلتا ویگو",
  "Deportivo": "دپورتیو",
  "Elche": "الچه",
  "Espanyol": "اسپانیول",
  "Getafe": "ختافه",
  "Levante": "لوانت",
  "Malaga": "مالاگا",
  "Osasuna": "اوساسونا",
  "Racing Santander": "راسینگ سانتندر",
  "Racing": "راسینگ",
  "Rayo Vallecano": "رایو والیکانو",
  "Rayo": "رایو",
  "Real Betis": "رئال بتیس",
  "Betis": "بتیس",
  "Real Sociedad": "رئال سوسیداد",
  "Bayern Munich": "بایرن مونیخ",
  "Bayern": "بایرن",
  "Borussia Dortmund": "بوروسیا دورتموند",
  "Dortmund": "دورتموند",
  "RB Leipzig": "آر‌بی لایپزیگ",
  "Leipzig": "لایپزیگ",
  "Leverkusen": "لورکوزن",
  "Bayer Leverkusen": "بایر لورکوزن",
  "Eintracht Frankfurt": "اینتراخت فرانکفورت",
  "Frankfurt": "فرانکفورت",
  "1. FC Union Berlin": "یونیون برلین",
  "Union": "یونیون",
  "Borussia Mönchengladbach": "بوروسیا منچن‌گلدباخ",
  "Gladbach": "منچن‌گلدباخ",
  "Wolfsburg": "وولفسبورگ",
  "FC Augsburg": "آگسبورگ",
  "Augsburg": "آگسبورگ",
  "FC Cologne": "کولن",
  "Cologne": "کولن",
  "Hamburg SV": "هامبورگ",
  "Hamburg": "هامبورگ",
  "Mainz": "ماینتس",
  "SC Freiburg": "فریبورگ",
  "Freiburg": "فریبورگ",
  "SC Paderborn 07": "پادربُرن",
  "Paderborn": "پادربُرن",
  "SV Elversberg": "الورسبرگ",
  "Elversberg": "الورسبرگ",
  "Schalke 04": "شالکه",
  "Schalke": "شالکه",
  "TSG Hoffenheim": "هفنینهایم",
  "Hoffenheim": "هفنینهایم",
  "VfB Stuttgart": "اف‌بیاشتوتگارت",
  "Stuttgart": "اشتوتگارت",
  "Werder Bremen": "وردر برمن",
  "Bremen": "برمن",
  "AC Milan": "آث میلان",
  "Milan": "میلان",
  "AS Roma": "اس‌رم",
  "Roma": "رم",
  "Juventus": "یوونتوس",
  "Napoli": "ناپولی",
  "Lazio": "لاتسیو",
  "Inter": "اینتر",
  "Internazionale": "اینترناسیوناله",
  "Atalanta": "اتالانتا",
  "Bologna": "بولونیا",
  "Cagliari": "کالیاری",
  "Como": "کومو",
  "Fiorentina": "فورنتینا",
  "Frosinone": "فرسينون",  // NOTE: actual is "Frosinone"
  "Genoa": "جنووا",
  "Paris Saint-Germain": "پاری سنت‌ژرمن",
  "PSG": "پاری سنت‌ژرمن",
  "Marseille": "مارسی",
  "Lyon": "لیون",
  "Monaco": "موناکو",
  "Lille": "لیل",
  "Lens": "لانس",
  "AS Monaco": "آ اس موناکو",
  "Lorient": "لوریان",
  "Angers": "آنگرس",
  "Brest": "برست",
  "Le Havre AC": "لو هاور",
  "Le Mans": "لومان",
  "Nice": "نیس",
  "Paris FC": "پاری اف‌سی",
  "Stade Rennais": "ستاد رنه",
  "Rennes": "رنه",
  "Strasbourg": "استراسبرگ",
  "Toulouse": "تولوز",
  "Troyes": "تروا",
  "AJ Auxerre": "آژ اوسِر",
  "Auxerre": "اوسِر",
};

function toFa(text) {
  return teamNamesFa[text] ?? text;
}

// Extract all distinct home_name and away_name from matches
const apiNames = new Set();
function extract(obj) {
  if (!obj) return;
  if (obj.home_name) apiNames.add(obj.home_name);
  if (obj.away_name) apiNames.add(obj.away_name);
  if (obj.home_short) apiNames.add(obj.home_short);
  if (obj.away_short) apiNames.add(obj.away_short);
}
// Also dig competitions
if (data.competitions) {
  data.competitions.forEach(comp => {
    if (comp.teams) {
      comp.teams.forEach(t => {
        if (t.name) apiNames.add(t.name);
        if (t.short_name) apiNames.add(t.short_name);
      });
    }
  });
}

data.matches.forEach(extract);

console.log("Total API team name entries: " + apiNames.size + "\n");

// Check coverage
const missing = [];
const found = [];
for (const name of apiNames) {
  const localized = toFa(name);
  if (localized === name) {
    missing.push(name);
  } else {
    found.push({ original: name, localized });
  }
}

console.log("Found Persian mapping (" + found.length + "):");
found.slice(0, 30).forEach(f => console.log("  " + f.original + " → " + f.localized));
console.log("  ... (showing first 30)");

console.log("\nMissing (no Persian mapping, falls back to English):");
missing.slice(0, 50).forEach(m => console.log("  " + m));
console.log("  ... (showing first 50)");

// Show total counts
console.log("\n--- SUMMARY ---");
console.log("Total distinct API names: " + apiNames.size);
console.log("With Persian mapping: " + (apiNames.size - missing.length));
console.log("Without Persian mapping (fallback to English): " + missing.length);

// Show missing grouped by likely league
console.log("\n--- MISSING NAMES (all) ---");
missing.forEach(m => console.log("  - " + m));