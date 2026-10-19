/**
 * UI/UX review, part B+C: assemble the requested source files into one
 * markdown bundle (.ui-shots/review/code-bundle.md), each file fenced with a
 * path header. Broken paths are reported, not skipped silently.
 *
 * Run: node scripts/collect-code.mjs
 */
import { readFileSync, writeFileSync } from "fs";

const ENTRIES = [
  // Part B — components
  ["src/components/TabBar.tsx", "src/components/TabBar.tsx"],
  ["src/components/AppShell.tsx", "src/components/AppShell.tsx"],
  ["src/components/TopBar.tsx", "src/components/TopBar.tsx"],
  ["src/components/ui.tsx", "src/components/ui.tsx — Button, Chip, Segmented, ListRow, EmptyState, ErrorState, TeamBadge, Num (full file)"],
  ["src/components/BottomSheet.tsx", "src/components/BottomSheet.tsx"],
  ["src/components/DateStrip.tsx", "src/components/DateStrip.tsx"],
  ["src/components/InlineAd.tsx", "src/components/InlineAd.tsx"],
  ["src/components/panels/LeaguePickerSheet.tsx", "src/components/panels/LeaguePickerSheet.tsx"],
  ["src/components/panels/LineupsPanel.tsx", "src/components/panels/LineupsPanel.tsx"],
  ["src/components/TimelineList.tsx", "src/components/TimelineList.tsx"],
  ["src/components/panels/CommentaryPanel.tsx", "src/components/panels/CommentaryPanel.tsx"],
  // tokens: the file the user guessed as src/styles/tokens.css actually lives at the repo root
  ["tokens.css", "tokens.css (imported by src/index.css as ../tokens.css — there is no src/styles/)"],
  ["src/index.css", "src/index.css — includes the Tailwind @theme mapping of the tokens"],
  // Part B — i18n direction handling (where dir="rtl" is set)
  ["src/i18n/I18nProvider.tsx", "src/i18n/I18nProvider.tsx — the ONLY place documentElement.dir is set"],
  // Part C — Telegram SDK
  ["src/lib/telegram.ts", "src/lib/telegram.ts — readiness/auth, theme params, viewport, haptics, share"],
  ["src/hooks/useBackNavigation.ts", "src/hooks/useBackNavigation.ts — Telegram BackButton wiring (mounted from AppShell)"],
];

const ICON_RE = /(?:^export const (ChevronLeftIcon|ChevronRightIcon|ChevronDownIcon|ArrowIcon))[\s\S]*?^\)/m;

function extractArrows(source) {
  // Take the named arrow/chevron exports plus whatever they interleave with
  // between them in that band of the file.
  const lines = source.split(/\r?\n/);
  const wanted = new Set(["ChevronRightIcon", "ChevronLeftIcon", "ChevronDownIcon", "ArrowIcon"]);
  const out = [];
  let collecting = false;
  let depth = 0;
  for (const line of lines) {
    const header = line.match(/^export const (\w+)/);
    if (header) {
      collecting = wanted.has(header[1]);
      depth = 0;
    }
    if (collecting) out.push(line);
    if (collecting && /[{(]/.test(line)) depth += (line.match(/[{(]/g) ?? []).length;
    if (collecting && /[})]/.test(line)) depth -= (line.match(/[})]/g) ?? []).length;
    if (collecting && depth <= 0 && /\)\s*;\s*$/.test(line)) collecting = false;
  }
  return out.join("\n");
}

let md = `# UI/UX review — code bundle (part B + C)\n\nGenerated from the working tree. Screenshot set lives beside this file (.ui-shots/review/).\n\n`;
let missing = [];
for (const [path, label] of ENTRIES) {
  let body;
  try {
    body = readFileSync(path, "utf8");
  } catch {
    missing.push(path);
    continue;
  }
  md += `\n\n---\n\n## \`${path}\`\n\n${label}\n\n\`\`\`\n${body}\n\`\`\`\n`;
}
// icons: chevron/arrow band only
md += `\n\n---\n\n## \`src/components/icons.tsx\` (excerpt)\n\n\nThe chevron/arrow icons only, as requested. For the full 216-line file see the repo.\n\n\`\`\`tsx\n${extractArrows(readFileSync("src/components/icons.tsx", "utf8"))}\n\`\`\`\n`;

if (missing.length > 0) {
  md += `\n\n---\n\n## MISSING — requested but not present in the repo\n\n${missing.map((m) => `- \`${m}\``).join("\n")}\n`;
  console.error("MISSING:", missing.join(", "));
}

writeFileSync(".ui-shots/review/code-bundle.md", md);
console.log(`bundle written: .ui-shots/review/code-bundle.md (${(md.length / 1024).toFixed(1)} KB), missing: ${missing.length}`);
