/**
 * Shared helpers for the theme locale-file rules (`theme/locale-key-naming`,
 * `theme/locale-file-parity`). Pure functions over parsed JSON — no theme
 * context needed, so they unit-test without a fixture theme.
 *
 * The budgets mirror the platform contract: the backend overlay stores
 * `<theme-slug>.<key>` in a varchar(64) column with the slug capped at 23
 * chars, so the dotted key gets the remaining 40; values cap at 1000 chars
 * and files cap at 3400 keys per the Shopify locale docs
 * (https://shopify.dev/docs/themes/architecture/locales).
 */

/** Dotted lowercase key grammar: `scope.thing.state`. No hyphens — see below. */
export const LOCALE_KEY_PATTERN = /^[a-z0-9]+(\.[a-z0-9]+)*$/;

/**
 * Why no hyphens in key segments: the theme slug already uses hyphens
 * (`[a-z0-9-]`, up to 23 chars) and the backend stores `<slug>.<key>` as one
 * varchar(64) value. Keeping key segments to `[a-z0-9]` keeps the slug half
 * and the key half visually and programmatically distinct (greppable,
 * splittable on dots), and matches the kit's own dictionary grammar.
 */
export const LOCALE_KEY_MAX_LENGTH = 40;

/** Translation values cap at 1000 chars (same Shopify limit as the key cap). */
export const LOCALE_VALUE_MAX_LENGTH = 1000;

/** At most 3400 translation keys per file (Shopify's locale-file limit). */
export const LOCALE_FILE_MAX_KEYS = 3400;

/** Doc URL cited for the 3400-key and 1000-char limits. */
export const LOCALE_LIMITS_DOC_URL = 'https://shopify.dev/docs/themes/architecture/locales';

/** Theme slug budget: `<slug>.<key>` must fit varchar(64) → 23 + 1 + 40. */
export const THEME_SLUG_MAX_LENGTH = 23;
export const THEME_SLUG_PATTERN = /^[a-z0-9-]+$/;

/**
 * Plural map shape: `{one,two,few,many,other,zero}` of strings. `other` is
 * required — it is the fallback form the kit renders when no form matches.
 */
export const PLURAL_FORMS = ['one', 'two', 'few', 'many', 'other', 'zero'] as const;
export type PluralForm = (typeof PLURAL_FORMS)[number];
const PLURAL_SET = new Set<string>(PLURAL_FORMS);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** True when the object is a plural map (every key is a plural form). */
export function isPluralMapShape(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => PLURAL_SET.has(key));
}

/** One flattened leaf: its dotted key and raw value. */
export interface LocaleLeaf {
  key: string;
  value: unknown;
}

/** A structural conflict between two spellings of the same dotted key. */
export interface LocaleConflict {
  key: string;
  kind: 'duplicate' | 'leaf-prefix';
}

/**
 * Flattens a parsed locale file to dotted-path leaves. Both spellings work:
 * nested objects (`{"cart": {"title": "…"}}`) and flat dotted keys
 * (`{"cart.title": "…"}`) resolve to the same `cart.title` leaf, exactly like
 * the kit's runtime lookup. Returns the leaves plus structural conflicts:
 * the same key defined twice (flat + nested), or a key that is both a leaf
 * value and a prefix of another key (`cart.add` vs `cart.add.label`).
 */
export function flattenLocaleEntries(root: unknown): { leaves: LocaleLeaf[]; conflicts: LocaleConflict[] } {
  const leaves: LocaleLeaf[] = [];
  const seen = new Map<string, number>();
  const leafKeys = new Set<string>();

  const visit = (node: unknown, segments: string[]): void => {
    if (typeof node === 'string' || isPluralMapShape(node)) {
      const key = segments.join('.');
      leaves.push({ key, value: node });
      seen.set(key, (seen.get(key) ?? 0) + 1);
      leafKeys.add(key);
      return;
    }
    if (!isRecord(node)) {
      // Numbers, booleans, null, arrays: not strings or plural maps. Kept as
      // a leaf so the rule can flag the type instead of silently dropping it.
      const key = segments.join('.');
      leaves.push({ key, value: node });
      seen.set(key, (seen.get(key) ?? 0) + 1);
      leafKeys.add(key);
      return;
    }
    if (Object.keys(node).length === 0) return;
    // An object mixing plural forms with sub-keys is neither a plural map
    // nor a scope: keep it whole so the rule flags it once, without noise
    // from descending into half-plural children.
    if (Object.keys(node).some((k) => PLURAL_SET.has(k))) {
      const key = segments.join('.');
      leaves.push({ key, value: node });
      seen.set(key, (seen.get(key) ?? 0) + 1);
      leafKeys.add(key);
      return;
    }
    for (const [child, entry] of Object.entries(node)) visit(entry, [...segments, child]);
  };

  if (isRecord(root)) {
    for (const [key, entry] of Object.entries(root)) visit(entry, key.split('.'));
  }

  const conflicts: LocaleConflict[] = [];
  for (const [key, count] of seen) {
    if (count > 1) conflicts.push({ key, kind: 'duplicate' });
  }
  for (const key of leafKeys) {
    // A leaf that is also a prefix of another leaf (`cart.add` beside
    // `cart.add.label`) can never resolve unambiguously — flag it once.
    for (const other of leafKeys) {
      if (other !== key && other.startsWith(`${key}.`)) {
        conflicts.push({ key, kind: 'leaf-prefix' });
        break;
      }
    }
  }
  return { leaves, conflicts };
}

/** Raw `<tag>` in a translation value. Escaped `&lt;` is the correct way. */
const RAW_HTML_PATTERN = /<\/?[A-Za-z][^<>]*>/;

/** True when the value contains a raw HTML tag. */
export function hasRawHtml(value: string): boolean {
  return RAW_HTML_PATTERN.test(value);
}

const PLACEHOLDER_OPEN = '\u0000';
const PLACEHOLDER_CLOSE = '\u0001';

const INTERPOLATION_NAME = '[A-Za-z0-9_]+';

/**
 * Interpolation variables (`{name}`) in a value. `{{`/`}}` are literal-brace
 * escapes (same as the kit renderer) and never count as variables.
 */
export function extractInterpolationVars(value: string): string[] {
  const masked = value.replace(/{{/g, PLACEHOLDER_OPEN).replace(/}}/g, PLACEHOLDER_CLOSE);
  const vars = new Set<string>();
  for (const match of masked.matchAll(new RegExp(`\\{(${INTERPOLATION_NAME})\\}`, 'g'))) {
    const name = match[1];
    if (name !== undefined) vars.add(name);
  }
  return [...vars];
}

/** All interpolation vars used by a leaf (union across plural forms). */
export function leafInterpolationVars(value: unknown): string[] {
  if (typeof value === 'string') return extractInterpolationVars(value);
  if (isPluralMapShape(value)) {
    const vars = new Set<string>();
    for (const form of Object.values(value)) {
      if (typeof form === 'string') {
        for (const name of extractInterpolationVars(form)) vars.add(name);
      }
    }
    return [...vars];
  }
  return [];
}

/** The kit catalogue accepts `fr`, `pt-BR`, … (mirrors its parseLocaleCode). */
export const LOCALE_CODE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
export const LOCALE_CODE_MAX_LENGTH = 12;

/** The default file is exactly this — English is the fallback authority. */
export const DEFAULT_LOCALE_FILE = 'en.default.json';

/**
 * The locale code for a `locales/*.json` file name, or null when the name is
 * invalid. `en.default.json` maps to `en`; other files must be `<code>.json`.
 * A bare `en.json` is invalid — English lives in `en.default.json` only.
 */
export function localeCodeOfFile(fileName: string): string | null {
  if (!fileName.endsWith('.json')) return null;
  const stem = fileName.slice(0, -'.json'.length);
  if (stem === 'en.default') return 'en';
  if (stem.toLowerCase() === 'en' || !LOCALE_CODE_PATTERN.test(stem) || stem.length > LOCALE_CODE_MAX_LENGTH) {
    return null;
  }
  return stem;
}
