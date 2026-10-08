#!/usr/bin/env node
/**
 * Regenerates `packages/theme-check/src/kit-core-strings.ts` from the kit's
 * `locales/en.default.json` — the snapshot `theme/locale-key-exists` accepts
 * without a new dependency.
 *
 * Usage (from the repo root):
 *   node scripts/sync-kit-core-strings.mjs <path-to-theme-kit/locales/en.default.json>
 *   KIT_DICTIONARY_PATH=<path-to-theme-kit/locales/en.default.json> node scripts/sync-kit-core-strings.mjs
 *
 * The source dictionary is required: pass it as the first argument, or set
 * KIT_DICTIONARY_PATH (the same variable the drift test reads). The script
 * exits 1 with a message when neither is given. Pass `--check` to verify the
 * snapshot is current instead of rewriting it (non-zero exit when it drifts),
 * and `--source=<version>` to stamp the theme-kit version the snapshot was cut
 * from. Besides `kit-core-strings.ts` it refreshes the verbatim copy at
 * `packages/theme-check/test/fixtures/kit-en.default.json` that the drift test
 * compares (also in CI via KIT_DICTIONARY_PATH), so the guard fires even where
 * no kit checkout is available. Never writes outside the repo.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'packages/theme-check/src/kit-core-strings.ts');
const FIXTURE = join(root, 'packages/theme-check/test/fixtures/kit-en.default.json');
const PLURAL = new Set(['one', 'two', 'few', 'many', 'other', 'zero']);

function flatten(node, prefix, out) {
  for (const [key, value] of Object.entries(node)) {
    const full = prefix === '' ? key : `${prefix}.${key}`;
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).every((k) => PLURAL.has(k))) {
      flatten(value, full, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const checkOnly = process.argv.includes('--check');
const kitArg = process.argv.slice(2).find((arg) => !arg.startsWith('-') && arg.endsWith('.json')) ?? process.env.KIT_DICTIONARY_PATH;
if (!kitArg) {
  console.error('sync-kit-core-strings: no source dictionary. Pass the path to theme-kit\'s locales/en.default.json as an argument, or set KIT_DICTIONARY_PATH.');
  process.exit(1);
}
const kitPath = resolve(kitArg);
const sourceArg = process.argv.find((arg) => arg.startsWith('--source='));
const version = (sourceArg ?? '').slice('--source='.length);

const raw = readFileSync(kitPath, 'utf8');
const dict = JSON.parse(raw);
const keys = flatten(dict, '', []).sort();
let fixtureCurrent = null;
try {
  fixtureCurrent = readFileSync(FIXTURE, 'utf8');
} catch {
  fixtureCurrent = null;
}
if (fixtureCurrent !== raw) {
  if (checkOnly) {
    console.error(`kit fixture ${FIXTURE} drifts from ${kitPath}. Run scripts/sync-kit-core-strings.mjs.`);
    process.exit(1);
  }
  mkdirSync(dirname(FIXTURE), { recursive: true });
  writeFileSync(FIXTURE, raw);
}
const lines = keys.map((key) => `  '${key}',`).join('\n');
const body = `/** Sorted flattened keys of the kit core English dictionary (generated). */
export const KIT_CORE_KEYS: readonly string[] = [
${lines}
];
`;
const current = readFileSync(OUT, 'utf8');
const next = current.replace(/\/\*\* Sorted flattened keys[\s\S]*?\];\n/, `${body}`);
if (next === current) {
  console.log(`kit-core-strings.ts already current (${keys.length} keys).`);
  process.exit(0);
}
if (checkOnly) {
  console.error(`kit-core-strings.ts drifts from ${kitPath} (${keys.length} keys). Run scripts/sync-kit-core-strings.mjs.`);
  process.exit(1);
}
if (version !== '') {
  const stamped = next.replace(
    /export const KIT_CORE_SOURCE = '[^']*';/,
    `export const KIT_CORE_SOURCE = '@usequeek/theme-kit@${version} locales/en.default.json';`,
  );
  writeFileSync(OUT, stamped);
} else {
  writeFileSync(OUT, next);
}
console.log(`kit-core-strings.ts + test fixture updated from ${kitPath} (${keys.length} keys).`);
