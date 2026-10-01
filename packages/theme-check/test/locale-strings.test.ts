import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BRAND_NAMES, isBrandNameToken } from '../src/allowlist/brand-names.js';
import { localeFileParityRule, localeKeyNamingRule } from '../src/rules/locale-strings.js';
import type { ThemeContext } from '../src/types.js';
import {
  extractInterpolationVars,
  flattenLocaleEntries,
  localeCodeOfFile,
} from '../src/utils/locale-files.js';

const copies: string[] = [];
afterEach(() => { for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A scratch theme directory with exactly these files. */
function themeDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'locale-strings-'));
  copies.push(dir);
  for (const [rel, text] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
  return dir;
}

function contextFor(dir: string, slug = 'bare'): ThemeContext {
  return {
    env: {
      root: 'theme/',
      docs: 'https://example.test/THEME.md',
      vocabulary: 'the vocabulary',
      scaffold: 'npm create @usequeek/theme',
      preview: (id) => `http://localhost:7833/${id}`,
      submission: false,
    },
    slug,
    dir,
    retired: false,
    demo: null,
    demos: [],
    themeConfig: null,
    declaredDemos: [],
    defaultDescription: null,
    defaultFor: null,
    themeDescription: null,
    manifest: null,
    pageBased: false,
    file: (path) => join(dir, path),
    exists: (path) => existsSync(join(dir, path)),
    read: (path) => {
      try {
        return readFileSync(join(dir, path), 'utf8');
      } catch {
        return null;
      }
    },
  };
}

const locales = (files: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(files).map(([name, text]) => [`locales/${name}`, text]));

const EN = JSON.stringify({
  cart: { title: 'Your cart', count: { one: '{count} item', other: '{count} items' } },
  'cart.empty': 'Your cart is empty',
});

describe('theme/locale-key-naming', () => {
  it('passes nested, flat and plural spellings of valid keys', () => {
    const dir = themeDir(locales({
      'en.default.json': JSON.stringify({
        cart: {
          title: 'Your cart',
          count: { one: '{count} item', other: '{count} items', zero: 'No items' },
        },
        'cart.empty': 'Your cart is empty',
        help: '5 < 10, use &lt;b&gt; for markup and {{name}} for braces',
      }),
    }));
    expect(localeKeyNamingRule.run(contextFor(dir))).toEqual([]);
  });

  it('is silent when the theme ships no locale files', () => {
    expect(localeKeyNamingRule.run(contextFor(themeDir({})))).toEqual([]);
  });

  it('flags keys outside the dotted-lowercase grammar, naming the key', () => {
    const dir = themeDir(locales({
      'en.default.json': JSON.stringify({
        'Cart.Title': 'a',
        'cart-item': 'b',
        'cart..empty': 'c',
        'cart title': 'd',
      }),
    }));
    const findings = localeKeyNamingRule.run(contextFor(dir));
    for (const bad of ['Cart.Title', 'cart-item', 'cart..empty', 'cart title']) {
      const hit = findings.find((finding) => finding.found.includes(`"${bad}"`));
      expect(hit, bad).toBeDefined();
      expect(hit?.severity).toBe('warn');
    }
  });

  it('accepts a 40-char key and flags a 41-char key', () => {
    const ok = `k${'a'.repeat(39)}`;
    const tooLong = `k${'a'.repeat(40)}`;
    expect(ok).toHaveLength(40);
    expect(tooLong).toHaveLength(41);
    const passing = themeDir(locales({ 'en.default.json': JSON.stringify({ [ok]: 'v' }) }));
    expect(localeKeyNamingRule.run(contextFor(passing))).toEqual([]);
    const failing = themeDir(locales({ 'en.default.json': JSON.stringify({ [tooLong]: 'v' }) }));
    const findings = localeKeyNamingRule.run(contextFor(failing));
    expect(findings.find((finding) => finding.found.includes(`"${tooLong}"`) && finding.found.includes('41 chars'))).toBeDefined();
  });

  it('accepts a 23-char slug and flags a 24-char slug', () => {
    const files = locales({ 'en.default.json': JSON.stringify({ 'cart.title': 'Your cart' }) });
    expect(localeKeyNamingRule.run(contextFor(themeDir(files), 's'.repeat(23)))).toEqual([]);
    const findings = localeKeyNamingRule.run(contextFor(themeDir(files), 's'.repeat(24)));
    expect(findings.find((finding) => finding.found.includes('24 chars'))).toBeDefined();
  });

  it('flags a slug outside [a-z0-9-]', () => {
    const dir = themeDir(locales({ 'en.default.json': JSON.stringify({ 'cart.title': 'Your cart' }) }));
    const findings = localeKeyNamingRule.run(contextFor(dir, 'Bare_Theme'));
    expect(findings.find((finding) => finding.found.includes('"Bare_Theme"'))).toBeDefined();
  });

  it('accepts a 1000-char value and flags a 1001-char value', () => {
    const ok = themeDir(locales({ 'en.default.json': JSON.stringify({ 'cart.title': 'v'.repeat(1000) }) }));
    expect(localeKeyNamingRule.run(contextFor(ok))).toEqual([]);
    const failing = themeDir(locales({ 'en.default.json': JSON.stringify({ 'cart.title': 'v'.repeat(1001) }) }));
    const findings = localeKeyNamingRule.run(contextFor(failing));
    expect(findings.find((finding) => finding.found.includes('1001 chars'))).toBeDefined();
  });

  it('flags raw HTML tags but allows escaped markup and bare comparisons', () => {
    const dir = themeDir(locales({
      'en.default.json': JSON.stringify({
        'a.tagged': 'Use <b>bold</b> here',
        'a.closed': 'Ends </div> here',
        'a.escaped': 'Use &lt;b&gt; for bold',
        'a.plain': '5 < 10 always',
      }),
    }));
    const findings = localeKeyNamingRule.run(contextFor(dir));
    expect(findings.find((finding) => finding.found.includes('"a.tagged"'))).toBeDefined();
    expect(findings.find((finding) => finding.found.includes('"a.closed"'))).toBeDefined();
    expect(findings.find((finding) => finding.found.includes('a.escaped'))).toBeUndefined();
    expect(findings.find((finding) => finding.found.includes('a.plain'))).toBeUndefined();
  });

  it('flags empty and blank values', () => {
    const dir = themeDir(locales({
      'en.default.json': JSON.stringify({ 'a.empty': '', 'a.blank': '   ', 'a.ok': 'x' }),
    }));
    const findings = localeKeyNamingRule.run(contextFor(dir));
    expect(findings.find((finding) => finding.found.includes('"a.empty"'))).toBeDefined();
    expect(findings.find((finding) => finding.found.includes('"a.blank"'))).toBeDefined();
    expect(findings.find((finding) => finding.found.includes('a.ok'))).toBeUndefined();
  });

  it('flags a key that is both a leaf and a prefix of another key', () => {
    const dir = themeDir(locales({
      'en.default.json': JSON.stringify({ 'cart.add': 'Add', 'cart.add.label': 'Add label' }),
    }));
    const findings = localeKeyNamingRule.run(contextFor(dir));
    expect(findings.find((finding) => finding.found.includes('"cart.add"') && finding.found.includes('both a value and a prefix'))).toBeDefined();
  });

  it('flags the same key defined flat and nested (duplicate)', () => {
    const dir = themeDir(locales({
      'en.default.json': JSON.stringify({ cart: { title: 'A' }, 'cart.title': 'B' }),
    }));
    const findings = localeKeyNamingRule.run(contextFor(dir));
    expect(findings.find((finding) => finding.found.includes('"cart.title"') && finding.found.includes('twice'))).toBeDefined();
  });

  it('accepts plural maps with zero, and flags a map without other', () => {
    const ok = themeDir(locales({
      'en.default.json': JSON.stringify({ 'cart.count': { zero: 'none', one: 'one', other: 'many' } }),
    }));
    expect(localeKeyNamingRule.run(contextFor(ok))).toEqual([]);
    const missing = themeDir(locales({
      'en.default.json': JSON.stringify({ 'cart.count': { one: 'one' } }),
    }));
    const findings = localeKeyNamingRule.run(contextFor(missing));
    expect(findings.find((finding) => finding.found.includes('"cart.count"') && finding.found.includes('"other"'))).toBeDefined();
  });

  it('flags non-string plural forms, mixed objects and scalar values', () => {
    const dir = themeDir(locales({
      'en.default.json': JSON.stringify({
        'a.forms': { one: 1, other: 'many' },
        'a.mixed': { one: 'one', label: 'Label' },
        'a.count': 3,
        'a.flag': true,
        'a.list': ['x'],
        'a.nothing': null,
      }),
    }));
    const findings = localeKeyNamingRule.run(contextFor(dir));
    expect(findings.find((finding) => finding.found.includes('"a.forms"'))).toBeDefined();
    expect(findings.find((finding) => finding.found.includes('"a.mixed"') && finding.found.includes('mixes plural forms'))).toBeDefined();
    for (const bad of ['a.count', 'a.flag', 'a.list', 'a.nothing']) {
      expect(findings.find((finding) => finding.found.includes(`"${bad}"`)), bad).toBeDefined();
    }
  });

  it('flags invalid JSON and a non-object root, naming the file', () => {
    const badJson = themeDir(locales({ 'en.default.json': '{oops' }));
    const jsonFindings = localeKeyNamingRule.run(contextFor(badJson));
    expect(jsonFindings).toHaveLength(1);
    expect(jsonFindings[0]?.found).toContain('locales/en.default.json is not valid JSON');
    const arrayRoot = themeDir(locales({ 'en.default.json': '["x"]' }));
    const rootFindings = localeKeyNamingRule.run(contextFor(arrayRoot));
    expect(rootFindings.find((finding) => finding.found.includes('must be a JSON object'))).toBeDefined();
  });

  it('accepts 3400 keys and flags 3401', () => {
    const keys = (count: number): string =>
      JSON.stringify(Object.fromEntries(Array.from({ length: count }, (_, i) => [`k${i}`, 'v'])));
    const ok = themeDir(locales({ 'en.default.json': keys(3400) }));
    expect(localeKeyNamingRule.run(contextFor(ok))).toEqual([]);
    const failing = themeDir(locales({ 'en.default.json': keys(3401) }));
    const findings = localeKeyNamingRule.run(contextFor(failing));
    expect(findings.find((finding) => finding.found.includes('3401 keys'))).toBeDefined();
  });
});

describe('theme/locale-file-parity', () => {
  it('is silent when the theme ships no locale files', () => {
    expect(localeFileParityRule.run(contextFor(themeDir({})))).toEqual([]);
  });

  it('passes a translation that matches English keys and variables', () => {
    const dir = themeDir(locales({
      'en.default.json': EN,
      'fr.json': JSON.stringify({
        cart: { title: 'Votre panier', count: { one: '{count} article', other: '{count} articles' } },
        'cart.empty': 'Votre panier est vide',
      }),
    }));
    expect(localeFileParityRule.run(contextFor(dir))).toEqual([]);
  });

  it('flags extra keys the English authority does not declare', () => {
    const dir = themeDir(locales({
      'en.default.json': EN,
      'fr.json': JSON.stringify({ 'cart.title': 'x', 'cart.extra': 'y' }),
    }));
    const findings = localeFileParityRule.run(contextFor(dir));
    const hit = findings.find((finding) => finding.found.includes('"cart.extra"'));
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe('warn');
    expect(hit?.where).toContain('locales/fr.json');
  });

  it('groups missing keys into one info-class warning (English covers them)', () => {
    const dir = themeDir(locales({
      'en.default.json': EN,
      'fr.json': JSON.stringify({ 'cart.title': 'x' }),
    }));
    const findings = localeFileParityRule.run(contextFor(dir));
    const missing = findings.filter((finding) => finding.found.includes('missing'));
    expect(missing).toHaveLength(1);
    expect(missing[0]?.found).toContain('English fallback');
  });

  it('flags translation variables outside the English subset', () => {
    const dir = themeDir(locales({
      'en.default.json': JSON.stringify({ 'cart.title': 'Hello {name}' }),
      'fr.json': JSON.stringify({ 'cart.title': 'Bonjour {name} {surname}' }),
    }));
    const findings = localeFileParityRule.run(contextFor(dir));
    const hit = findings.find((finding) => finding.found.includes('{surname}'));
    expect(hit).toBeDefined();
    expect(hit?.found).toContain('{name}');
  });

  it('requires the default file to be exactly en.default.json', () => {
    const dir = themeDir(locales({ 'fr.json': JSON.stringify({ 'cart.title': 'x' }) }));
    const findings = localeFileParityRule.run(contextFor(dir));
    expect(findings.find((finding) => finding.found.includes('locales/en.default.json'))).toBeDefined();
  });

  it('flags non-locale file names (en.json included) and accepts pt-BR', () => {
    const dir = themeDir(locales({
      'en.default.json': EN,
      'en.json': JSON.stringify({}),
      'xx_invalid.json': JSON.stringify({}),
      'pt-BR.json': JSON.stringify(JSON.parse(EN)),
    }));
    const findings = localeFileParityRule.run(contextFor(dir));
    expect(findings.find((finding) => finding.where.includes('locales/en.json'))).toBeDefined();
    expect(findings.find((finding) => finding.where.includes('locales/xx_invalid.json'))).toBeDefined();
    expect(findings.find((finding) => finding.where.includes('pt-BR'))).toBeUndefined();
  });

  it('flags a string-vs-plural shape mismatch for the same key', () => {
    const dir = themeDir(locales({
      'en.default.json': JSON.stringify({ 'cart.count': '{count} items' }),
      'fr.json': JSON.stringify({ 'cart.count': { one: 'un', other: 'plusieurs' } }),
    }));
    const findings = localeFileParityRule.run(contextFor(dir));
    expect(findings.find((finding) => finding.found.includes('"cart.count"') && finding.found.includes('shapes must match'))).toBeDefined();
  });

  it('skips parity for an unparseable translation (naming owns JSON validity)', () => {
    const dir = themeDir(locales({ 'en.default.json': EN, 'fr.json': '{oops' }));
    const findings = localeFileParityRule.run(contextFor(dir));
    expect(findings.filter((finding) => finding.where.includes('locales/fr.json'))).toEqual([]);
  });
});

describe('locale helpers', () => {
  it('flattens nested and flat spellings to the same dotted leaves', () => {
    const nested = flattenLocaleEntries({ cart: { title: 'a' } });
    const flat = flattenLocaleEntries({ 'cart.title': 'a' });
    expect(nested).toEqual(flat);
    expect(nested.leaves).toEqual([{ key: 'cart.title', value: 'a' }]);
    expect(nested.conflicts).toEqual([]);
  });

  it('extracts {vars} but not {{escaped}} braces', () => {
    expect(extractInterpolationVars('Hello {name}, {count} left')).toEqual(['name', 'count']);
    expect(extractInterpolationVars('Literal {{name}} here')).toEqual([]);
    expect(extractInterpolationVars('5 < 10')).toEqual([]);
  });

  it('validates locale file names like the kit catalogue', () => {
    expect(localeCodeOfFile('en.default.json')).toBe('en');
    expect(localeCodeOfFile('fr.json')).toBe('fr');
    expect(localeCodeOfFile('pt-BR.json')).toBe('pt-BR');
    expect(localeCodeOfFile('en.json')).toBeNull();
    expect(localeCodeOfFile('xx_invalid.json')).toBeNull();
    expect(localeCodeOfFile('fr.txt')).toBeNull();
  });

  it('ships a tiny documented brand-name allowlist for G0-enforce', () => {
    expect(BRAND_NAMES.length).toBeGreaterThan(0);
    expect(BRAND_NAMES.length).toBeLessThanOrEqual(20);
    for (const token of ['Queek', 'WhatsApp', 'NGN', 'kg']) expect(BRAND_NAMES).toContain(token);
    expect(isBrandNameToken('Queek')).toBe(true);
    expect(isBrandNameToken('queek')).toBe(false);
    expect(isBrandNameToken('Add to cart')).toBe(false);
  });
});
