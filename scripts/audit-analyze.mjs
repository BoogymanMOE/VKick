/**
 * Visual audit analyzer - inspects screenshots for common UI issues
 * Focuses on: clipped text, RTL bugs, low contrast, tap targets, alignment
 *
 * Reads screenshots and produces a findings table for the audit report.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

// We'll use the browser's rendering for analysis via Chrome CDP
// but for now, let's do a file-based analysis of what we captured

const SHOTS_DIR = '.ui-shots/audit-full';

function analyzeScreenshot(filename) {
  // Format: screen-state-lang-widthxheight.png or screen-lang-widthxheight.png
  const base = filename.replace('.png', '');
  const parts = base.split('-');
  // Try to parse: [screen, ...mid, lang, dims]
  // lang is 'en' or 'fa', dims is like '0360x0844'
  let lang = null;
  let dims = null;
  let screenParts = [];
  
  for (let i = parts.length - 1; i >= 0; i--) {
    if (!lang && (parts[i] === 'en' || parts[i] === 'fa')) {
      lang = parts[i];
    } else if (!dims && /^\d{4}x\d{4}$/.test(parts[i])) {
      dims = parts[i];
    } else if (i > 0) {
      screenParts.unshift(parts[i]);
    } else {
      screenParts.unshift(parts[i]);
    }
  }
  
  const screen = screenParts.join('-');
  return { filename, screen, lang, dims };
}

// Get all screenshots
import { readdirSync } from 'node:fs';
const files = readdirSync(SHOTS_DIR).filter(f => f.endsWith('.png'));

const shots = files.map(analyzeScreenshot);

console.log('=== VISUAL AUDIT: Screenshot Inventory ===\n');
console.log(`Total screenshots: ${shots.length}\n`);

// Group by screen
const byScreen = {};
for (const s of shots) {
  if (!byScreen[s.screen]) byScreen[s.screen] = [];
  byScreen[s.screen].push(s);
}

console.log('Screens covered:');
for (const [screen, items] of Object.entries(byScreen).sort()) {
  const langs = [...new Set(items.map(i => i.lang).filter(Boolean))].sort();
  const widths = [...new Set(items.map(i => i.dims).filter(Boolean))].sort();
  console.log(`  ${screen}:`);
  console.log(`    Langs: ${langs.join(', ') || '?'}`);
  console.log(`    Widths: ${widths.join(', ') || '?'}`);
  console.log(`    Files: ${items.length}`);
}

// Identify gaps
console.log('\n=== GAP ANALYSIS ===\n');

const screensExpected = [
  'matches-live', 'matches-upcoming', 'matches-empty', 'matches-loading',
  'match-detail-live', 'match-detail-finished', 'match-detail-upcoming',
  'table-league', 'cups-list', 'profile-settings', 'profile-favorites',
  'onboarding-step1', 'leaderboards', 'browse-leagues', 'settings-language'
];

const widthsExpected = ['0360x0844', '0390x0844', '0768x1024', '1280x0900'];
const langsExpected = ['en', 'fa'];

for (const screen of screensExpected) {
  const items = byScreen[screen] || [];
  const gotLangs = new Set(items.map(i => i.lang).filter(Boolean));
  const gotWidths = new Set(items.map(i => i.dims).filter(Boolean));

  const missingLangs = langsExpected.filter(l => !gotLangs.has(l));
  const missingWidths = widthsExpected.filter(w => !gotWidths.has(w));

  if (missingLangs.length || missingWidths.length) {
    console.log(`${screen}:`);
    if (missingWidths.length) console.log(`  MISSING widths: ${missingWidths.join(', ')}`);
    if (missingLangs.length) console.log(`  MISSING langs: ${missingLangs.join(', ')}`);
    if (!missingLangs.length && !missingWidths.length) console.log(`  FULLY CAPTURED`);
  } else {
    console.log(`${screen}: FULLY CAPTURED (${items.length} files)`);
  }
}

// Check for FA-only screens that weren't captured in EN
console.log('\n=== RTL COVERAGE ===');
for (const screen of screensExpected) {
  const faShots = (byScreen[screen] || []).filter(s => s.lang === 'fa');
  const enShots = (byScreen[screen] || []).filter(s => s.lang === 'en');
  const total = faShots.length + enShots.length;
  console.log(`${screen}: FA=${faShots.length}, EN=${enShots.length}, TOTAL=${total}`);
}
