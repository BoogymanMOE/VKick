// Writes demo/pages-code.md: the complete source of every ROUTED screen except
// the Matchday feed, straight out of the working tree (nothing is retyped, so
// the document cannot drift from the code).
//
// Usage: node scripts/pages-code.mjs
import fs from "node:fs";

const OUT = "demo/pages-code.md";

/**
 * The routed screens, in route order as App.tsx declares them, minus Matches
 * (the Matchday feed this document deliberately leaves out). `path` is the file
 * on disk; `route` is what main.tsx's HashRouter serves it at.
 */
const pages = [
  [
    "Login",
    "src/pages/Login.tsx",
    "/login",
    "Entry screen. Eager-loaded and outside the guarded shell, so a signed-out client never waits on a lazy chunk.",
  ],
  [
    "Onboarding",
    "src/pages/Onboarding.tsx",
    "/onboarding",
    "First run: the concept slides, then the favorite-team and league pickers.",
  ],
  [
    "Table",
    "src/pages/Table.tsx",
    "/table",
    "League tables plus the merged Browse browser, switched by the Tables/Browse control.",
  ],
  ["MatchDetail", "src/pages/MatchDetail.tsx", "/match/:id", "One match: timeline, stats, lineups."],
  ["TeamPage", "src/pages/TeamPage.tsx", "/team/:id", "Club hub: squad, fixtures, season and xG."],
  ["Cups", "src/pages/Cups.tsx", "/cups", "Knockout competitions and their fixtures."],
  ["Ratings", "src/pages/Ratings.tsx", "/ratings", "Crowd ratings for one match."],
  [
    "Profile",
    "src/pages/Profile.tsx",
    "/profile",
    "Account, favorites shelf, referrals, settings, What's new, legal and the danger zone.",
  ],
  [
    "Admin",
    "src/pages/Admin.tsx",
    "/admin",
    "Operator-only dashboard (gated server-side by ADMIN_TELEGRAM_IDS).",
  ],
  [
    "Privacy + Terms",
    "src/pages/Legal.tsx",
    "/privacy, /terms",
    "One renderer over the section lists in lib/legal.ts.",
  ],
  ["NotFound", "src/pages/NotFound.tsx", "*", "Unknown deep links say so instead of silently redirecting."],
];

const extra = [
  [
    "Routing table",
    "src/App.tsx",
    "",
    "Declares every route above, the auth guard around them and the one screen not in this document (Matches, the Matchday feed).",
  ],
  [
    "Router entry",
    "src/main.tsx",
    "",
    "Where HashRouter, the error boundary and the query client are wired; explains why routes are /#/…",
  ],
];

const read = (p) => fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const lang = (p) => (p.endsWith(".md") ? "md" : "tsx");
const lines = (p) => read(p).split("\n").length;

function section([title, path, route, blurb]) {
  return `### ${title}${route ? ` — \`${route}\`` : ""}

\`${path}\` · ${lines(path)} lines

${blurb}

\`\`\`${lang(path)}
${read(path).replace(/\n$/, "")}
\`\`\`
`;
}

const header = `# Vkick — the code of every page except Matchday

Generated from the working tree by \`scripts/pages-code.mjs\` (nothing here is
retyped, so it cannot drift from the code). \`Matches.tsx\`, the Matchday feed, is
the one screen left out — it is the screen this set was asked to exclude.

Routes are served by a **HashRouter** (\`src/main.tsx\`), so every URL in this
document is reached as \`/#\` + the path shown (e.g. \`http://localhost:5173/#/table\`).

Stack: React 18 + TypeScript + Vite, Tailwind v4 over the design tokens in
\`tokens.css\`, TanStack Query for server state, React Router for the shell,
Express + SQLite + the ESPN sync behind it.

Runnable album of the same screens: \`demo/index.html\`.

---

## Reading order

1. \`src/App.tsx\` — the routing table and the auth guard (below).
2. The pages, in route order.

---

## Contents

${[...pages, ...extra].map(([title, path]) => `- **${title}** — \`${path}\``).join("\n")}

---

`;

const body =
  "## Routing and entry\n\n" +
  extra.map(section).join("\n") +
  "\n---\n\n## Pages\n\n" +
  pages.map(section).join("\n");

fs.mkdirSync("demo", { recursive: true });
fs.writeFileSync(OUT, header + body);
const total = [...pages, ...extra].reduce((n, [, p]) => n + lines(p), 0);
console.log(
  `[pages-code] wrote ${OUT} — ${pages.length} screens + ${extra.length} entry files, ${total} lines of source`,
);
