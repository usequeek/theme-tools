import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import * as ts from 'typescript';
import { isBrandNameToken } from '../allowlist/brand-names.js';
import { kitCoreKeysFor } from '../kit-core-strings.js';
import { themeSourceFiles } from '../context.js';
import { finding, type Finding, type Rule, type ThemeContext } from '../types.js';
import {
  DEFAULT_LOCALE_FILE,
  flattenLocaleEntries,
  PLURAL_FORMS,
} from '../utils/locale-files.js';

/**
 * G0-enforce (warn-first, configurable like every other warn-capable rule):
 * closes the "forgotten key renders empty in production" hole and the "new
 * hard-coded text drift" hole.
 *
 * - `theme/locale-key-exists`: every `t('literal.key')` call in TS/TSX must
 *   resolve to the theme's own `locales/en.default.json` or the kit core
 *   dictionary. Any identifier called as `t(…)` counts — a `useThemeStrings()`
 *   binding, a `getThemeStrings`/`createThemeStrings` bound `t`, or a
 *   props-passed `t` all call through the same name. Dynamic (non-literal)
 *   keys are reported as info, never failed.
 * - `theme/locale-key-unused` (info): keys in `en.default.json` nothing
 *   references via `t('…')`.
 * - `theme/no-hardcoded-strings`: JSX text and copy-attribute string
 *   literals that are shopper-visible copy but not routed through `t()`.
 *   The shopper-copy-vs-noise judgement reuses the validated codemod's
 *   logic (`scripts/i18n-codemod.ts` in the storefront repo): the same NEVER
 *   list (routes, URLs, class tokens, currency codes, enum discriminators,
 *   brand/unit allowlist, merchant-data expressions) and the same audited
 *   copy-attribute set.
 *
 * All three default to `warn` (founder: warn one release, then reject for
 * third parties); `off` drops them, `error` upgrades them.
 */

const DOCS = (context: ThemeContext): string => `${context.env.docs}#locales`;

/**
 * A source file as a finding names it — `theme/…`, the same shape the other
 * source-scanning rules use (see theme/markdown-html), `/` on every OS.
 */
function themePath(context: ThemeContext, path: string): string {
  return `theme/${relative(context.dir, path).replace(/\\/g, '/')}`;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function parseThemeFile(path: string): { source: string; file: ts.SourceFile } | null {
  let source: string;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const kind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return { source, file: ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, kind) };
}

/* ── dictionary ─────────────────────────────────────────────────────── */

/** The theme's own flattened keys, or null when there is no usable dictionary. */
function ownKeys(context: ThemeContext): Set<string> | null {
  const text = context.read(`locales/${DEFAULT_LOCALE_FILE}`);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const keys = new Set<string>();
    for (const { key } of flattenLocaleEntries(parsed).leaves) {
      if (!keys.has(key)) keys.add(key);
    }
    return keys;
  } catch {
    return null;
  }
}

const PLURAL_SUFFIX = new Set<string>(PLURAL_FORMS);

/**
 * Accepts a referenced key against a known-key set, including the kit's flat
 * plural-suffix shape: a dictionary holding `cart.count.one`/`cart.count.other`
 * satisfies `t('cart.count')`, exactly like the runtime lookup.
 */
function resolvesKey(known: Set<string>, key: string): boolean {
  if (known.has(key)) return true;
  for (const candidate of known) {
    if (!candidate.startsWith(`${key}.`)) continue;
    if (PLURAL_SUFFIX.has(candidate.slice(key.length + 1))) return true;
  }
  return false;
}

/* ── t() references ─────────────────────────────────────────────────── */

interface TReference {
  path: string;
  line: number;
  /** The literal key, or null when the key is dynamic (non-literal). */
  key: string | null;
  /**
   * The static prefix of a dynamic key (template head or `'a.b.' + x` left
   * side), or null when the dynamic key carries no static text. The unused
   * rule treats a dictionary key under a referenced prefix as used — e.g.
   * t(`orders.tab.${key}`) keeps `orders.tab.all` alive.
   */
  prefix: string | null;
}

function dynamicPrefixOf(first: ts.Expression): string | null {
  if (ts.isTemplateExpression(first)) return first.head.text;
  if (
    ts.isBinaryExpression(first) &&
    first.operatorToken.kind === ts.SyntaxKind.PlusToken &&
    ts.isStringLiteral(first.left)
  ) {
    return first.left.text;
  }
  return null;
}

function isTCall(node: ts.CallExpression): boolean {
  const callee = node.expression;
  return (
    (ts.isIdentifier(callee) && callee.text === 't') ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === 't')
  );
}

/** Every `t(…)` call in one parsed file: literal keys plus dynamic sites. */
function tReferencesOf(path: string, sourceFile: ts.SourceFile): TReference[] {
  const refs: TReference[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTCall(node)) {
      const first = node.arguments[0];
      if (first === undefined) {
        // `t()` with no key: not a lookup, not a finding.
      } else if (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) {
        refs.push({ path, line: lineOf(sourceFile, first), key: first.text, prefix: null });
      } else {
        refs.push({ path, line: lineOf(sourceFile, first), key: null, prefix: dynamicPrefixOf(first) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return refs;
}

function themeTReferences(context: ThemeContext): TReference[] {
  const refs: TReference[] = [];
  for (const path of themeSourceFiles(context.dir)) {
    if (!path.endsWith('.ts') && !path.endsWith('.tsx')) continue;
    const parsed = parseThemeFile(path);
    if (parsed) refs.push(...tReferencesOf(path, parsed.file));
  }
  return refs;
}

/* ── shopper copy vs noise (codemod NEVER list, condensed) ──────────── */

/** Single lowercase code token (`card`, `grid`, `has_more`) — never a sentence. */
const CURRENCIES = new Set(['NGN', 'USD', 'EUR', 'GBP', 'GHS', 'KES']);
const UNITS = new Set(['kg', 'g', 'ml', 'cm']);
/** Brand names that may stay untranslated even lowercased mid-sentence. */
const BRAND_LOWER = new Set(['queek', 'whatsapp', 'verve', 'mastercard', 'visa']);
const CLASS_TOKEN = /(^|\s)(is-|has-)|--|__|(^[a-z][a-z0-9]*(-[a-z0-9]+)+$)/;
const CSS_VALUE = /^[+-]?[\d.]+(px|rem|em|%|s|ms|vh|vw|vmin|vmax|deg|ch|ex|fr|pt|pc|in|cm|mm|q)$/;

function decodeEntities(s: string): string {
  return s
    .replace(/&ldquo;/g, '“')
    .replace(/&rdquo;/g, '”')
    .replace(/&lsquo;/g, '‘')
    .replace(/&rsquo;/g, '’')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Collapse JSX whitespace the way JSX does, then trim. */
function normalizeJsxText(s: string): string {
  return decodeEntities(s.replace(/[\t ]*\n[\t ]*/g, ' ')).replace(/[ \t]+/g, ' ').trim();
}

/**
 * Why a raw string is NOT shopper copy (null = may be copy). Mirrors the
 * validated codemod's `skipReasonForValue`: routes, URLs, currency/unit
 * codes, the brand allowlist, identifier/class tokens and CSS values.
 */
function noiseReason(text: string): string | null {
  const t = text.trim();
  if (t === '') return 'empty-or-decorative';
  if (!/[A-Za-zÀ-ÿ]/.test(t)) return 'no-letters';
  if (t.length < 2) return 'too-short';
  if (t.startsWith('/')) return 'route-string';
  if (/^(https?:|mailto:|tel:|data:|ftp:|blob:|#)/i.test(t) || t.includes('://')) return 'url';
  if (CURRENCIES.has(t)) return 'currency-code';
  if (UNITS.has(t)) return 'unit-token';
  if (isBrandNameToken(t) || (BRAND_LOWER.has(t.toLowerCase()) && !t.includes(' '))) return 'allowlist-brand';
  if (!t.includes(' ') && (t.includes('--') || t.includes('_'))) return 'identifier-token';
  if (!t.includes(' ') && t.includes('-') && /^[a-z0-9-]+$/i.test(t)) return 'css-class-token';
  if (/^url\(/i.test(t)) return 'css-url';
  if (CSS_VALUE.test(t)) return 'css-value';
  if (
    /\s/.test(t) &&
    /^\d+(\.\d+)?(px|%|em|rem|vh|vw|vmin|vmax|fr|ch|ex|cm|mm|in|pt|pc|s|ms)?(\s+\d+(\.\d+)?(px|%|em|rem|vh|vw|vmin|vmax|fr|ch|ex|cm|mm|in|pt|pc|s|ms)?)+$/.test(t) &&
    /(px|%|em|rem|vh|vw|vmin|vmax|fr|ch|ex|cm|mm|in|pt|pc|s|ms)/.test(t)
  ) {
    return 'css-value';
  }
  if (t.startsWith('.') && (t.includes(',') || t.includes('--') || t.includes('__'))) return 'css-selector';
  if (CLASS_TOKEN.test(t) && !t.includes(' ')) return 'css-class-token';
  return null;
}

/**
 * The only JSX attributes whose string values are UI copy — the codemod's
 * audited set. `actionLabel`/`moreLabel` are custom link-label props the
 * codemod audited on SectionHead/Intro-style headers; every other
 * `*Label`/`*Text` prop stays out. Anything else (className, href, id, role,
 * data-*, …) is never copy.
 */
const COPY_ATTRS = new Set([
  'aria-label',
  'aria-description',
  'placeholder',
  'title',
  'alt',
  'label',
  'actionLabel',
  'moreLabel',
]);

/* ── rules ──────────────────────────────────────────────────────────── */

/**
 * `theme/locale-key-exists`: every `t('literal.key')` resolves to the
 * theme's own `locales/en.default.json` or the kit core dictionary. A key
 * absent from both renders EMPTY in production (the kit never prints the raw
 * key), so a forgotten key is a warn-first finding with file:line + key.
 */
export const localeKeyExistsRule: Rule = {
  id: 'theme/locale-key-exists',
  summary: 'Every t() key exists in the theme dictionary or the kit core dictionary (missing keys render empty)',
  kind: 'static',
  run(context) {
    const own = ownKeys(context);
    const known = kitCoreKeysFor(context.dir);
    if (own !== null) for (const key of own) known.add(key);

    const findings: Finding[] = [];
    for (const ref of themeTReferences(context)) {
      const where = `${themePath(context, ref.path)}:${ref.line}`;
      if (ref.key === null) {
        findings.push(finding(context, 'theme/locale-key-exists', 'warn', {
          where,
          found: 't(…) uses a dynamic key here — the check cannot resolve it statically (info: confirm the key exists in locales/en.default.json)',
          fix: 'Prefer a literal key so the check (and the next reader) can see it; when the key must stay dynamic, confirm every value it can take exists in locales/en.default.json.',
          docs: DOCS(context),
        }));
        continue;
      }
      if (resolvesKey(known, ref.key)) continue;
      findings.push(finding(context, 'theme/locale-key-exists', 'warn', {
        where,
        found: `t('${ref.key}') has no entry in locales/${DEFAULT_LOCALE_FILE} or the kit core dictionary — shoppers see an empty string where this renders`,
        fix: `Add "${ref.key}" to locales/${DEFAULT_LOCALE_FILE} (or reuse a kit core key with the same English).`,
        docs: DOCS(context),
      }));
    }
    return findings;
  },
};

/**
 * `theme/locale-key-unused` (info): keys in `en.default.json` nothing
 * references via `t('…')` — dead copy that translators still pay for.
 */
export const localeKeyUnusedRule: Rule = {
  id: 'theme/locale-key-unused',
  summary: 'Keys in en.default.json nothing references are dead copy (info)',
  kind: 'static',
  run(context) {
    const own = ownKeys(context);
    if (own === null) return [];
    const referenced = new Set<string>();
    const prefixes: string[] = [];
    for (const ref of themeTReferences(context)) {
      if (ref.key !== null) referenced.add(ref.key);
      else if (ref.prefix !== null && ref.prefix !== '' && ref.prefix.includes('.')) prefixes.push(ref.prefix);
    }
    const findings: Finding[] = [];
    for (const key of [...own].sort()) {
      // A flat plural-suffix key (`cart.count.one`) is used via `t('cart.count')`,
      // and a key under a dynamic template's static prefix (t(`orders.tab.${k}`))
      // is used by that template.
      const used =
        [...referenced].some((ref) => ref === key || (key.startsWith(`${ref}.`) && PLURAL_SUFFIX.has(key.slice(ref.length + 1)))) ||
        prefixes.some((prefix) => key.startsWith(prefix));
      if (used) continue;
      findings.push(finding(context, 'theme/locale-key-unused', 'warn', {
        where: `${context.env.root}locales/${DEFAULT_LOCALE_FILE} → "${key}"`,
        found: `key "${key}" in locales/${DEFAULT_LOCALE_FILE} is never referenced by t('…') (info: dead copy translators still pay for)`,
        fix: `Delete "${key}" when nothing renders it, or route the copy through t('${key}').`,
        docs: DOCS(context),
      }));
    }
    return findings;
  },
};

/**
 * `theme/no-hardcoded-strings`: JSX text nodes and string-literal values of
 * the audited copy attributes that are shopper-visible copy but not routed
 * through `t()`. Merchant data (`{product.title}`), non-copy attributes,
 * brand/unit tokens and strings already inside `t()` never flag.
 */
export const noHardcodedStringsRule: Rule = {
  id: 'theme/no-hardcoded-strings',
  summary: 'Shopper-visible JSX text and copy attributes go through t(), not hard-coded literals',
  kind: 'static',
  run(context) {
    const findings: Finding[] = [];
    for (const path of themeSourceFiles(context.dir)) {
      if (!path.endsWith('.tsx')) continue;
      const parsed = parseThemeFile(path);
      if (!parsed) continue;
      const { file } = parsed;
      const add = (node: ts.Node, text: string): void => {
        findings.push(finding(context, 'theme/no-hardcoded-strings', 'warn', {
          where: `${themePath(context, path)}:${lineOf(file, node)}`,
          found: `hard-coded shopper copy "${text.slice(0, 120)}" — route it through t('…') so it translates`,
          fix: `Move the copy into locales/${DEFAULT_LOCALE_FILE} and render {t('scope.key')} (or t('scope.key', vars) for interpolation).`,
          docs: DOCS(context),
        }));
      };
      const visit = (node: ts.Node): void => {
        if (ts.isJsxText(node)) {
          const text = normalizeJsxText(node.text);
          if (text !== '' && noiseReason(text) === null) add(node, text);
        } else if (ts.isJsxAttribute(node)) {
          const name = ts.isIdentifier(node.name) ? node.name.text : node.name.name.text;
          if (COPY_ATTRS.has(name) && node.initializer !== undefined) {
            const inner =
              ts.isJsxExpression(node.initializer) && node.initializer.expression !== undefined
                ? node.initializer.expression
                : null;
            const value =
              ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer)
                ? node.initializer.text
                : inner !== null &&
                    (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner))
                  ? inner.text
                  : null;
            if (value !== null && value.trim() !== '' && noiseReason(value) === null) add(node, value.trim());
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }
    return findings;
  },
};

export const LOCALE_ENFORCE_RULES: Rule[] = [localeKeyExistsRule, localeKeyUnusedRule, noHardcodedStringsRule];
