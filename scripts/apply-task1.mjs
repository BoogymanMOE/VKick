const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'src', 'pages', 'Matches.tsx');

let content = fs.readFileSync(file, 'utf8');

// We apply anchored replacements, one block at a time.

const replacements = [
  // 1) UI import: Card -> useLocalState (Task 1: no longer renders the Card-based empty card)
  {
    from: 'import { Card, EmptyState, ErrorState } from "../components/ui";',
    to: 'import { EmptyState, ErrorState } from "../components/ui";\nimport { useLocalState } from "../lib/useLocalState";',
  },

  // 2) Remove the dead `_banner` line that only existed to occupy a line in Task 1.
  {
    from: '  const _banner = favCount ?? favCount;\r\n',
    to: '',
  },

  // 3) Insert the pick-banner local-state block, in one anchored chunk, after LEAGUE_CHIP_OFF/pad.
  {
    from: 'const LEAGUE_CHIP_OFF = "border-line text-ink-3";\r\n\r\nconst pad = (n: number) => String(n).padStart(2, "0");\r\n',
    to: 'const LEAGUE_CHIP_OFF = "border-line text-ink-3";\r\n\r\nconst pad = (n: number) => String(n).padStart(2, "0");\r\n\r\n/**\r\n * Pick-banner dismiss is persisted so a user who already said “don’t show me\r\n * this again” keeps that choice after reload — the stored id beats the\r\n * computed “we don’t have any favorites” default.\r\n */\r\nconst [bannerDismissed, setBannerDismissed] = useLocalState<boolean>("verdikick.pickBannerDismissed", false);\r\nconst showPickBanner = favCount === 0 && !bannerDismissed;\r\n',
  },
  // 4) Insert the early-use memo-style block right after dayMatches (used by Task 5 later).
  {
    from: '  const dayMatches = useMemo(\r\n    () => matches.filter((m) => dayKey(new Date(m.kickoffAt)) === selectedKey).sort(byPlay),\r\n    [matches, selectedKey],\r\n  );\r\n',
    to: '  const dayMatches = useMemo(\r\n    () => matches.filter((m) => dayKey(new Date(m.kickoffAt)) === selectedKey).sort(byPlay),\r\n    [matches, selectedKey],\r\n  );\r\n  const _banner = favCount ?? favCount;\r\n',
  },

  // 4) Empty-card block: Card + BallIcon -> pick-banner region with dismiss; split into a header chunk and a body chunk so each edit is small and anchored.
  {
    from: '<Card className="pitch-watermark mt-4 p-5 text-center">\r\n            {/* An icon at the head of the card: the empty state is a moment to\r\n                act, not a blank slab, and the ball names the app it belongs to. */}\r\n            <BallIcon className="mx-auto h-8 w-8 text-volt" />\r\n            <p className="mt-2 text-sm font-bold text-ink">{t("myTeams.empty")}</p>',
    to: '<div\r\n            role="region"\r\n            aria-label={t("matches.pickBanner")}\r\n            className="mt-3 flex min-h-11 items-center gap-2 rounded-card border border-line bg-elevated ps-3 pe-1"\r\n          >\r\n            <StarFilledIcon className="h-4 w-4 flex-none text-gold" aria-hidden="true" />\r\n            <p className="min-w-0 flex-1 text-xs font-bold text-ink">{t("matches.pickBanner")}</p>',
  },
  // 5) Body of the old empty card block: hint + Link + closing Card -> banner body + dismiss button.
  {
    from: '            <p className="mt-1 text-xs text-ink-3">{t("myTeams.hint")}</p>\r\n            {/* The one action this card owns: everything else on the screen is\r\n                a different job, so there is no second button to split the intent. */}\r\n            <Link\r\n              to="/onboarding"\r\n              className="mt-4 inline-flex min-h-11 items-center justify-center rounded-full bg-volt px-5 text-sm font-bold text-black transition-[filter] duration-[var(--t-fast)] hover:brightness-95"\r\n            >\r\n              {t("matches.pickTeams")}',
    to: '            <Link\r\n              to="/onboarding"\r\n              onClick={() => haptic("light")}\r\n              className="inline-flex min-h-11 flex-none items-center rounded-full bg-volt px-4 text-xs font-bold text-black"\r\n            >\r\n              {t("matches.pickBannerCta")}',
  },
  // 6) Closing tag of the old empty card block -> banner closing tag + dismiss button.
  {
    from: '            </Link>\r\n          </Card>',
    to: '            </Link>\r\n            <button\r\n              type="button"\r\n              aria-label={t("matches.pickBannerDismiss")}\r\n              onClick={() => {\r\n                haptic("light");\r\n                setBannerDismissed(true);\r\n              }}\r\n              className="grid h-11 w-11 flex-none place-items-center rounded-full text-ink-3"\r\n            >\r\n              <CloseIcon className="h-4 w-4" aria-hidden="true" />\r\n            </button>\r\n          </div>',
  },
  // 7) Done marker.
  {
    from: '            </Link>\r\n            <button',
    to: '            </Link>\r\n            <button',
  },
];

let changed = false;



for (const r of replacements) {
  if (content.includes(r.from)) {
    content = content.split(r.from).join(r.to);
    changed = true;
    console.log('applied:', r.from.substring(0, 60));
  } else {
    console.warn('NOT FOUND:', r.from.substring(0, 80));
  }
}

if (!changed) {
  console.error('No replacements applied; aborting write.');
  process.exit(1);
}

fs.writeFileSync(file, content, 'utf8');
console.log('wrote', file);
