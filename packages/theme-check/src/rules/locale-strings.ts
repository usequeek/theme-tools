import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { finding, type Finding, type Rule, type ThemeContext } from '../types.js';
import {
  DEFAULT_LOCALE_FILE,
  LOCALE_CODE_MAX_LENGTH,
  LOCALE_FILE_MAX_KEYS,
  LOCALE_KEY_MAX_LENGTH,
  LOCALE_KEY_PATTERN,
  LOCALE_LIMITS_DOC_URL,
  LOCALE_VALUE_MAX_LENGTH,
  THEME_SLUG_MAX_LENGTH,
  THEME_SLUG_PATTERN,
  extractInterpolationVars,
  flattenLocaleEntries,
  hasRawHtml,
  isPluralMapShape,
  leafInterpolationVars,
  localeCodeOfFile,
} from '../utils/locale-files.js';

/**
 * Theme string files (`locales/en.default.json` + `locales/{lang}.json`,
 * Shopify-shaped). Both rules default to `warn` for this first release
 * (founder decision: warn one release, then reject) and are configurable
 * like every other warn-capable rule (`off` drops them, `error` upgrades).
 */

const LOCALES_DOCS = (context: ThemeContext): string => `${context.env.docs}#locales`;

/** Non-ignored `locales/*.json` file names, sorted. */
function localeFiles(context: ThemeContext): string[] {
  const dir = join(context.dir, 'locales');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json') && context.exists(`locales/${name}`))
      .sort();
  } catch {
    return [];
  }
}

function parseLocale(context: ThemeContext, name: string): { parsed: unknown } | { error: string } {
  const text = context.read(`locales/${name}`);
  if (text === null) return { error: '' };
  try {
    return { parsed: JSON.parse(text) as unknown };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function checkStringValue(context: ThemeContext, findings: Finding[], where: string, label: string, value: string): void {
  if (value.trim() === '') {
    findings.push(finding(context, 'theme/locale-key-naming', 'warn', {
      where,
      found: `key "${label}" is empty — every key needs a real string (delete the key if it is unused)`,
      fix: 'Give the key its English string, or delete the key when nothing renders it.',
      docs: LOCALES_DOCS(context),
    }));
    return;
  }
  if (value.length > LOCALE_VALUE_MAX_LENGTH) {
    findings.push(finding(context, 'theme/locale-key-naming', 'warn', {
      where,
      found: `key "${label}" is ${value.length} chars (max ${LOCALE_VALUE_MAX_LENGTH}) — translation values cap at ${LOCALE_VALUE_MAX_LENGTH} chars`,
      fix: `Shorten the value to ${LOCALE_VALUE_MAX_LENGTH} chars or fewer; split long copy across two keys.`,
      docs: LOCALE_LIMITS_DOC_URL,
    }));
  }
  if (hasRawHtml(value)) {
    findings.push(finding(context, 'theme/locale-key-naming', 'warn', {
      where,
      found: `key "${label}" contains a raw HTML tag — locale values must be plain text (escape it as &lt; when shoppers must see the brackets)`,
      fix: 'Remove the tag from the value (style in the component instead) or escape it as &lt;…&gt;.',
      docs: LOCALES_DOCS(context),
    }));
  }
}

/**
 * `theme/locale-key-naming`: every key in `locales/*.json` is dotted
 * lowercase `scope.thing.state` (`[a-z0-9]+(\.[a-z0-9]+)*`, no hyphens —
 * the slug already uses hyphens, so keys stay hyphen-free to keep
 * `<slug>.<key>` unambiguous), at most 40 chars so `<theme-slug>.<key>`
 * fits the backend overlay's varchar(64) with a ≤23-char slug.
 */
export const localeKeyNamingRule: Rule = {
  id: 'theme/locale-key-naming',
  summary: 'Locale keys are dotted lowercase scope.thing.state (≤40 chars, no hyphens), values are strings or plural maps (≤1000 chars, no HTML, no empties)',
  kind: 'static',
  run(context) {
    const files = localeFiles(context);
    if (files.length === 0) return [];
    const findings: Finding[] = [];

    // The overlay stores `<theme-slug>.<key>` in one varchar(64): the key
    // gets 40 chars, the slug 23. Check the slug when locale files exist.
    if (!THEME_SLUG_PATTERN.test(context.slug)) {
      findings.push(finding(context, 'theme/locale-key-naming', 'warn', {
        where: `${context.env.root}theme.config.ts`,
        found: `theme slug "${context.slug}" uses characters outside [a-z0-9-] — overlay keys are "<slug>.<key>", so the slug keeps to lowercase letters, digits and hyphens`,
        fix: 'Rename the theme slug to lowercase letters, digits and hyphens only.',
        docs: LOCALES_DOCS(context),
      }));
    } else if (context.slug.length > THEME_SLUG_MAX_LENGTH) {
      findings.push(finding(context, 'theme/locale-key-naming', 'warn', {
        where: `${context.env.root}theme.config.ts`,
        found: `theme slug "${context.slug}" is ${context.slug.length} chars (max ${THEME_SLUG_MAX_LENGTH}) — "<slug>.<key>" must fit varchar(64) with a ≤40-char key`,
        fix: `Shorten the theme slug to ${THEME_SLUG_MAX_LENGTH} chars or fewer.`,
        docs: LOCALES_DOCS(context),
      }));
    }

    for (const name of files) {
      const where = `${context.env.root}locales/${name}`;
      const result = parseLocale(context, name);
      if ('error' in result) {
        if (result.error !== '') {
          findings.push(finding(context, 'theme/locale-key-naming', 'warn', {
            where,
            found: `locales/${name} is not valid JSON — ${result.error}`,
            fix: 'Fix the JSON syntax so the file parses (trailing commas and comments are not JSON).',
            docs: LOCALES_DOCS(context),
          }));
        }
        continue;
      }
      if (!isRecord(result.parsed)) {
        findings.push(finding(context, 'theme/locale-key-naming', 'warn', {
          where,
          found: `locales/${name} must be a JSON object of keys — found ${Array.isArray(result.parsed) ? 'an array' : typeof result.parsed}`,
          fix: 'Make the file a JSON object mapping dotted keys (or nested scopes) to strings.',
          docs: LOCALES_DOCS(context),
        }));
        continue;
      }
      const { leaves, conflicts } = flattenLocaleEntries(result.parsed);
      if (leaves.length > LOCALE_FILE_MAX_KEYS) {
        findings.push(finding(context, 'theme/locale-key-naming', 'warn', {
          where,
          found: `locales/${name} has ${leaves.length} keys (max ${LOCALE_FILE_MAX_KEYS} per file) — split the theme's copy or drop unused keys`,
          fix: `Bring the file to ${LOCALE_FILE_MAX_KEYS} keys or fewer; delete keys nothing renders.`,
          docs: LOCALE_LIMITS_DOC_URL,
        }));
      }
      for (const { key, value } of leaves) {
        const at = `${where} → "${key}"`;
        if (!LOCALE_KEY_PATTERN.test(key)) {
          findings.push(finding(context, 'theme/locale-key-naming', 'warn', {
            where: at,
            found: `key "${key}" must be dotted lowercase scope.thing.state ([a-z0-9]+, dots between) — no capitals, hyphens, spaces or empty segments (hyphens belong to the theme slug, not the key)`,
            fix: 'Rename the key to dotted lowercase segments, e.g. "cart.add.label". Flat ("a.b") and nested ({"a": {"b"}}) spellings are the same key.',
            docs: LOCALES_DOCS(context),
          }));
        }
        if (key.length > LOCALE_KEY_MAX_LENGTH) {
          findings.push(finding(context, 'theme/locale-key-naming', 'warn', {
            where: at,
            found: `key "${key}" is ${key.length} chars (max ${LOCALE_KEY_MAX_LENGTH}) — "<slug>.<key>" must fit varchar(64)`,
            fix: `Shorten the key to ${LOCALE_KEY_MAX_LENGTH} chars or fewer.`,
            docs: LOCALES_DOCS(context),
          }));
        }
        if (typeof value === 'string') {
          checkStringValue(context, findings, at, key, value);
        } else if (isPluralMapShape(value)) {
          if (typeof value['other'] !== 'string') {
            findings.push(finding(context, 'theme/locale-key-naming', 'warn', {
              where: at,
              found: `key "${key}" is a plural map without a usable "other" form — "other" is the fallback the kit renders when no form matches`,
              fix: 'Add an "other" string to the plural map (allowed forms: one, two, few, many, other, zero).',
              docs: LOCALES_DOCS(context),
            }));
          }
          for (const [form, text] of Object.entries(value)) {
            if (typeof text !== 'string') {
              findings.push(finding(context, 'theme/locale-key-naming', 'warn', {
                where: at,
                found: `key "${key}" plural "${form}" must be a string — found ${text === null ? 'null' : Array.isArray(text) ? 'an array' : typeof text}`,
                fix: 'Make every plural form a string.',
                docs: LOCALES_DOCS(context),
              }));
            } else {
              checkStringValue(context, findings, at, `${key} (plural "${form}")`, text);
            }
          }
        } else if (isRecord(value)) {
          findings.push(finding(context, 'theme/locale-key-naming', 'warn', {
            where: at,
            found: `key "${key}" mixes plural forms with sub-keys — an object is either a plural map ({one,two,few,many,other,zero} of strings) or a scope of sub-keys, never both`,
            fix: 'Split it: keep the plural map under its own key and move the sub-keys elsewhere.',
            docs: LOCALES_DOCS(context),
          }));
        } else {
          findings.push(finding(context, 'theme/locale-key-naming', 'warn', {
            where: at,
            found: `key "${key}" must be a string or a plural map ({one,two,few,many,other,zero} of strings) — found ${value === null ? 'null' : Array.isArray(value) ? 'an array' : typeof value}`,
            fix: 'Make the value a string, or a plural map of strings.',
            docs: LOCALES_DOCS(context),
          }));
        }
      }
      for (const { key, kind } of conflicts) {
        findings.push(finding(context, 'theme/locale-key-naming', 'warn', {
          where: `${where} → "${key}"`,
          found: kind === 'duplicate'
            ? `key "${key}" is defined twice in locales/${name} (flat "a.b" and nested {"a": {"b"}} are the same key) — keep one spelling`
            : `key "${key}" is both a value and a prefix of another key (e.g. "${key}" beside "${key}.label") — a key is either a leaf or a scope, never both`,
          fix: kind === 'duplicate'
            ? 'Delete one of the two spellings so the key is defined once.'
            : 'Rename one side so no key is both a leaf value and a parent scope.',
          docs: LOCALES_DOCS(context),
        }));
      }
    }
    return findings;
  },
};

/**
 * `theme/locale-file-parity`: `en.default.json` is the fallback authority.
 * Extra keys in a translation never render (error class); missing keys fall
 * back to English (info class); interpolation variables must stay a subset
 * of the English ones or the render drops them.
 */
export const localeFileParityRule: Rule = {
  id: 'theme/locale-file-parity',
  summary: 'Every locales/{lang}.json key exists in en.default.json, and its {variables} stay a subset of the English ones',
  kind: 'static',
  run(context) {
    const files = localeFiles(context);
    if (files.length === 0) return [];
    const findings: Finding[] = [];

    if (!files.includes(DEFAULT_LOCALE_FILE)) {
      findings.push(finding(context, 'theme/locale-file-parity', 'warn', {
        where: `${context.env.root}locales/`,
        found: `no locales/${DEFAULT_LOCALE_FILE} — the default file must be exactly ${DEFAULT_LOCALE_FILE}; English is the fallback authority every translation is checked against`,
        fix: `Add locales/${DEFAULT_LOCALE_FILE} with every UI string, and name other files <code>.json (fr, pt-BR, …).`,
        docs: LOCALES_DOCS(context),
      }));
      return findings;
    }
    const fallback = parseLocale(context, DEFAULT_LOCALE_FILE);
    if ('error' in fallback || !isRecord(fallback.parsed)) return [];
    const authority = flattenLocaleEntries(fallback.parsed);
    const authorityMap = new Map<string, unknown>();
    for (const { key, value } of authority.leaves) {
      if (!authorityMap.has(key)) authorityMap.set(key, value);
    }

    for (const name of files) {
      if (name === DEFAULT_LOCALE_FILE) continue;
      const where = `${context.env.root}locales/${name}`;
      if (localeCodeOfFile(name) === null) {
        findings.push(finding(context, 'theme/locale-file-parity', 'warn', {
          where,
          found: `locales/${name} is not a valid locale file name — name translation files <code>.json with a BCP-47-ish code (fr, pt-BR, …, max ${LOCALE_CODE_MAX_LENGTH} chars); English lives in ${DEFAULT_LOCALE_FILE} only`,
          fix: `Rename the file to <code>.json (e.g. locales/fr.json), or delete it.`,
          docs: LOCALES_DOCS(context),
        }));
        continue;
      }
      const result = parseLocale(context, name);
      if ('error' in result || !isRecord(result.parsed)) continue;
      const { leaves } = flattenLocaleEntries(result.parsed);
      const seen = new Set<string>();
      const translation = new Map<string, unknown>();
      for (const { key, value } of leaves) {
        if (!seen.has(key)) {
          seen.add(key);
          translation.set(key, value);
        }
      }
      for (const key of translation.keys()) {
        if (authorityMap.has(key)) continue;
        findings.push(finding(context, 'theme/locale-file-parity', 'warn', {
          where: `${where} → extra key "${key}"`,
          found: `key "${key}" in locales/${name} is not in locales/${DEFAULT_LOCALE_FILE} — English is the fallback authority, so extra keys never render; delete it (or add it to English first)`,
          fix: `Delete "${key}" from locales/${name}, or add it to locales/${DEFAULT_LOCALE_FILE} when shoppers need it.`,
          docs: LOCALES_DOCS(context),
        }));
      }
      const missing = [...authorityMap.keys()].filter((key) => !translation.has(key));
      if (missing.length > 0) {
        const shown = missing.slice(0, 10).map((key) => `"${key}"`).join(', ');
        findings.push(finding(context, 'theme/locale-file-parity', 'warn', {
          where,
          found: `locales/${name} is missing ${missing.length} key${missing.length === 1 ? '' : 's'} from locales/${DEFAULT_LOCALE_FILE} (shoppers see the English fallback): ${shown}${missing.length > 10 ? `, and ${missing.length - 10} more` : ''}`,
          fix: 'Translate the missing keys, or leave them when English is acceptable for this locale.',
          docs: LOCALES_DOCS(context),
        }));
      }
      for (const [key, value] of translation) {
        if (!authorityMap.has(key)) continue;
        const english = authorityMap.get(key);
        const englishIsText = typeof english === 'string' || isPluralMapShape(english);
        const translationIsText = typeof value === 'string' || isPluralMapShape(value);
        if (!englishIsText || !translationIsText) continue;
        if (typeof english === 'string' !== (typeof value === 'string')) {
          findings.push(finding(context, 'theme/locale-file-parity', 'warn', {
            where: `${where} → "${key}"`,
            found: `key "${key}" in locales/${name} is a ${typeof value === 'string' ? 'plain string' : 'plural map'} but a ${typeof english === 'string' ? 'plural map' : 'plain string'} in locales/${DEFAULT_LOCALE_FILE} — the shapes must match or the render picks the wrong branch`,
            fix: 'Make the translation the same shape as the English value (both strings, or both plural maps).',
            docs: LOCALES_DOCS(context),
          }));
          continue;
        }
        const declared = leafInterpolationVars(english);
        const used = leafInterpolationVars(value);
        const unknown = used.filter((name) => !declared.includes(name));
        if (unknown.length === 0) continue;
        const names = (list: string[]): string => (list.length === 0 ? 'none' : list.map((n) => `{${n}}`).join(', '));
        findings.push(finding(context, 'theme/locale-file-parity', 'warn', {
          where: `${where} → "${key}"`,
          found: `key "${key}" in locales/${name} uses ${names(unknown)} which locales/${DEFAULT_LOCALE_FILE} does not declare (declares: ${names(declared)}) — undeclared variables render empty; use only the English variables`,
          fix: `Replace ${names(unknown)} with one of ${names(declared)}${declared.length === 0 ? ' (English declares none, so use no variables)' : ''}, or add the variable to the English value first.`,
          docs: LOCALES_DOCS(context),
        }));
      }
    }
    return findings;
  },
};

/** Interpolation variables helper, exported for unit tests. */
export { extractInterpolationVars as localeInterpolationVars };
