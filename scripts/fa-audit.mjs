import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const src = readFileSync(join(ROOT, 'src/i18n/strings.ts'), 'utf8');

// Extract the EN object body: everything between the first `en: {` and the
// top-level separator before `fa:`.
const enStart = src.indexOf('en: {');
if (enStart < 0) throw new Error('en: { not found');
const enOpen = src.indexOf('{', enStart);
const faMarker = src.indexOf('fa:', enOpen);
if (faMarker < 0) throw new Error('fa: section not found');

const enBody = src.slice(enOpen + 1, faMarker).trim();

// Extract the FA object body: from `fa: {` to end of file.
const faStart = src.indexOf('fa: {');
const faBody = src.slice(faStart).trim();
// Drop the leading `fa: {`.
const faBodyTrimmed = faBody.slice(faBody.indexOf('{') + 1).trim();
// The FA object is the last top-level value in the file; its closing brace is
// the final `}` in the file.
const faClose = faBodyTrimmed.lastIndexOf('}');
const faInner = faBodyTrimmed.slice(0, faClose).trim();

function extractValues(body) {
  const out = new Map();
  // Match keys like "foo.bar": "value"  — handles escaped chars inside values.
  const re = /"([^"]+)":\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(body))) {
    out.set(m[1], m[2].replace(/\\u200c/g, '').replace(/\\n/g, ' ').trim());
  }
  return out;
}

const enMap = extractValues(enBody);
const faMap = extractValues(faInner);

const ALLOWLIST = new Set([
  // Brand / product
  'Vkick',
  // Data sources / metrics / acronyms that are intentionally not translated
  'ESPN','Understat','VAR','MVP','xPts','PPDA','xG','xA',
  // Position codes
  'GK','DEF','MID','FWD',
  // Day-name codes used in date strip (these are short stock abbreviations in EN; FA uses separate localized tokens, so they are intentionally not 1:1 translated here and we still exclude them from the 'identical' check to avoid noise)
  'Mon','Tue','Wed','Thu','Fri','Sat','Sun',
]);

const enKeys = new Set(enMap.keys());
const faKeys = new Set(faMap.keys());

const emptyFA = [];
const identicalToEN = [];
const missingInFA = [];
const missingInEN = [];

for (const k of [...enKeys, ...faKeys]) {
  const enVal = enMap.get(k);
  const faVal = faMap.get(k);
  if (enVal === undefined) {
    missingInEN.push(k);
    continue;
  }
  if (faVal === undefined) {
    missingInFA.push(k);
    continue;
  }
  if (faVal === '') {
    emptyFA.push(k);
    continue;
  }
  if (ALLOWLIST.has(enVal) || ALLOWLIST.has(faVal)) continue;
  // Identical after normalisation (ZWNJ already stripped; spaces collapsed above).
  if (enVal === faVal) identicalToEN.push(k);
}

console.log(`EN keys: ${enKeys.size}`);
console.log(`FA keys: ${faKeys.size}`);
console.log(`EMPTY FA values: ${emptyFA.length}`);
emptyFA.forEach((k) => console.log(`  - ${k}`));
console.log(`FA identical to EN (excl. allowlist): ${identicalToEN.length}`);
identicalToEN.forEach((k) => console.log(`  - ${k}  [en=${JSON.stringify(enMap.get(k))}]`));
console.log(`MISSING IN FA (have EN, no FA): ${missingInFA.length}`);
missingInFA.forEach((k) => console.log(`  - ${k}  [en=${JSON.stringify(enMap.get(k))}]`));
console.log(`MISSING IN EN (have FA, no EN): ${missingInEN.length}`);
missingInEN.forEach((k) => console.log(`  - ${k}  [fa=${JSON.stringify(faMap.get(k))}]`));
