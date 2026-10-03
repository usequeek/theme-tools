import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { KIT_CORE_KEYS, KIT_CORE_SOURCE } from '../src/kit-core-strings.js';
import { localeKeyExistsRule, localeKeyUnusedRule, noHardcodedStringsRule } from '../src/rules/locale-enforce.js';
import type { ThemeContext } from '../src/types.js';
import { flattenLocaleEntries, LOCALE_KEY_PATTERN } from '../src/utils/locale-files.js';

const copies: string[] = [];
afterEach(() => { for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** A scratch theme directory with exactly these files. */
function themeDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'locale-enforce-'));
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

const EN = JSON.stringify({
  cart: { title: 'Your cart' },
  'wishlist.empty': 'Your wishlist is empty',
});

const CLIENT = (body: string): string =>
  `'use client';\nimport { useThemeStrings } from '@usequeek/theme-kit/provider';\nexport function Block(): unknown {\n  const t = useThemeStrings();\n  return ${body};\n}\n`;

describe('theme/locale-key-exists', () => {
  it('passes literal keys from the theme dictionary, nested and flat', () => {
    const dir = themeDir({
      'locales/en.default.json': EN,
      'blocks/a.tsx': CLIENT(`<div><h1>{t('cart.title')}</h1><p>{t('wishlist.empty')}</p></div>`),
    });
    expect(localeKeyExistsRule.run(contextFor(dir))).toEqual([]);
  });

  it('passes kit core keys the theme dictionary omits (kit English is the fallback)', () => {
    const kitKey = KIT_CORE_KEYS.find((key) => key === 'checkout.zone.title') ?? KIT_CORE_KEYS[0]!;
    const dir = themeDir({
      'locales/en.default.json': JSON.stringify({ 'cart.title': 'Your cart' }),
      'blocks/a.tsx': CLIENT(`<h1>{t('${kitKey}')}</h1>`),
    });
    expect(localeKeyExistsRule.run(contextFor(dir))).toEqual([]);
  });

  it('flags a t() literal missing everywhere, with file:line and the key', () => {
    const dir = themeDir({
      'locales/en.default.json': EN,
      'blocks/a.tsx': CLIENT(`<h1>{t('missing.key')}</h1>`),
    });
    const findings = localeKeyExistsRule.run(contextFor(dir));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warn');
    expect(findings[0]?.where).toBe('theme/blocks/a.tsx:5');
    expect(findings[0]?.found).toContain('missing.key');
  });

  it('flags a props-passed t the same as a hook-bound one', () => {
    const dir = themeDir({
      'locales/en.default.json': EN,
      'blocks/a.tsx': `export function Block({ t }: { t: (key: string) => string }): unknown {\n  return <h1>{t('props.missing')}</h1>;\n}\n`,
    });
    const findings = localeKeyExistsRule.run(contextFor(dir));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.found).toContain('props.missing');
  });

  it('resolves keys through a renamed hook binding and flags missing ones (roast ts() shape)', () => {
    const dir = themeDir({
      'locales/en.default.json': JSON.stringify({ testimonials: { next: 'Next' } }),
      'blocks/a.tsx': `'use client';\nimport { useThemeStrings } from '@usequeek/theme-kit/provider';\nexport function Block(): unknown {\n  const ts = useThemeStrings();\n  return <button aria-label={ts('testimonials.next')}>{ts('alias.missing')}</button>;\n}\n`,
    });
    const findings = localeKeyExistsRule.run(contextFor(dir));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.found).toContain('alias.missing');
  });

  it('treats a destructured renamed binding as t', () => {
    const dir = themeDir({
      'locales/en.default.json': EN,
      'blocks/a.tsx': `'use client';\nimport { useThemeStrings } from '@usequeek/theme-kit/provider';\nexport function Block(): unknown {\n  const { t: translate } = useThemeStrings();\n  return <h1>{translate('renamed.missing')}</h1>;\n}\n`,
    });
    const findings = localeKeyExistsRule.run(contextFor(dir));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.found).toContain('renamed.missing');
  });

  it('reports dynamic (non-literal) keys as info instead of failing them', () => {
    const dir = themeDir({
      'locales/en.default.json': EN,
      'blocks/a.tsx': CLIENT(`<h1>{t(key)}</h1>`),
    });
    const findings = localeKeyExistsRule.run(contextFor(dir));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warn');
    expect(findings[0]?.found).toContain('dynamic');
  });

  it('accepts t() for a plural written as flat suffix keys (kit runtime shape)', () => {
    const dir = themeDir({
      'locales/en.default.json': JSON.stringify({ 'cart.count.one': '{count} item', 'cart.count.other': '{count} items' }),
      'blocks/a.tsx': CLIENT(`<h1>{t('cart.count', { count })}</h1>`),
    });
    expect(localeKeyExistsRule.run(contextFor(dir))).toEqual([]);
  });

  it('ignores t() with no key argument and never crashes on an unparseable dictionary', () => {
    const dir = themeDir({
      'locales/en.default.json': '{oops',
      'blocks/a.tsx': CLIENT(`<h1>{t()}</h1>`),
    });
    expect(localeKeyExistsRule.run(contextFor(dir))).toEqual([]);
  });

  it('mutation: a dev adding t() for a key with no dictionary entry gets exactly one finding', () => {
    const dir = themeDir({
      'locales/en.default.json': EN,
      'blocks/a.tsx': CLIENT(`<div><h1>{t('cart.title')}</h1><button>{t('wishlist.add')}</button></div>`),
    });
    const findings = localeKeyExistsRule.run(contextFor(dir));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.found).toContain('wishlist.add');
  });
});

describe('theme/locale-key-unused', () => {
  it('flags dictionary keys nothing references, pointing at the dictionary', () => {
    const dir = themeDir({
      'locales/en.default.json': EN,
      'blocks/a.tsx': CLIENT(`<h1>{t('cart.title')}</h1>`),
    });
    const findings = localeKeyUnusedRule.run(contextFor(dir));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warn');
    expect(findings[0]?.where).toContain('locales/en.default.json');
    expect(findings[0]?.found).toContain('wishlist.empty');
  });

  it('is silent when every key is referenced, and when there is no dictionary', () => {
    const dir = themeDir({
      'locales/en.default.json': EN,
      'blocks/a.tsx': CLIENT(`<div>{t('cart.title')}{t('wishlist.empty')}</div>`),
    });
    expect(localeKeyUnusedRule.run(contextFor(dir))).toEqual([]);
    expect(localeKeyUnusedRule.run(contextFor(themeDir({ 'blocks/a.tsx': CLIENT('<h1>Hi</h1>') })))).toEqual([]);
  });

  it('keeps keys alive that only a renamed hook binding references (roast ts() shape)', () => {
    const dir = themeDir({
      'locales/en.default.json': JSON.stringify({ 'testimonials.next': 'Next', 'stale.key': 'Stale' }),
      'blocks/a.tsx': `'use client';\nimport { useThemeStrings } from '@usequeek/theme-kit/provider';\nexport function Block(): unknown {\n  const ts = useThemeStrings();\n  return <button aria-label={ts('testimonials.next')}>x</button>;\n}\n`,
    });
    const unused = localeKeyUnusedRule.run(contextFor(dir));
    expect(unused).toHaveLength(1);
    expect(unused[0]?.found).toContain('stale.key');
  });

  it('keeps keys alive that a dynamic template prefix covers (lumiere orders.tab shape)', () => {
    const dir = themeDir({
      'locales/en.default.json': JSON.stringify({ 'orders.tab.all': 'All', 'orders.tab.delivered': 'Delivered', 'orders.stale': 'Stale' }),
      'blocks/a.tsx': CLIENT(`<div>{STATUS_TABS.map((key) => <button key={key}>{t(` + '`orders.tab.${key}`)' + `}</button>)}</div>`),
    });
    const unused = localeKeyUnusedRule.run(contextFor(dir));
    expect(unused).toHaveLength(1);
    expect(unused[0]?.found).toContain('orders.stale');
    const exists = localeKeyExistsRule.run(contextFor(dir));
    expect(exists).toHaveLength(1);
    expect(exists[0]?.found).toContain('dynamic');
  });
});

describe('theme/no-hardcoded-strings', () => {
  const CLEAN = {
    'locales/en.default.json': EN,
    'blocks/a.tsx': CLIENT(
      `<div className="card"><h1>{t('cart.title')}</h1><p>{product.title}</p><a href="/shop">x</a><span>Queek</span><span>NGN</span></div>`,
    ),
  };

  it('passes routed copy, merchant data, non-copy attributes and brand/unit tokens', () => {
    expect(noHardcodedStringsRule.run(contextFor(themeDir(CLEAN)))).toEqual([]);
  });

  it('mutation: a dev adding hard-coded JSX text to a clean theme gets a finding', () => {
    const dir = themeDir({
      ...CLEAN,
      'blocks/a.tsx': CLIENT(
        `<div><h1>{t('cart.title')}</h1><button>Add to wishlist</button></div>`,
      ),
    });
    const findings = noHardcodedStringsRule.run(contextFor(dir));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('warn');
    expect(findings[0]?.where).toMatch(/^theme\/blocks\/a\.tsx:\d+$/);
    expect(findings[0]?.found).toContain('Add to wishlist');
  });

  it('flags string literals in copy attributes, including the audited *Label props', () => {
    const dir = themeDir({
      'blocks/a.tsx': CLIENT(
        `<div><button aria-label="Close cart">x</button><input placeholder="Search products" /><img alt="Red boots" /><Comp actionLabel="See more" moreLabel="More" sectionLabel="Intro" /></div>`,
      ),
    });
    const findings = noHardcodedStringsRule.run(contextFor(dir));
    const found = findings.map((finding) => finding.found);
    for (const text of ['Close cart', 'Search products', 'Red boots', 'See more', 'More']) {
      expect(found.some((entry) => entry.includes(text)), text).toBe(true);
    }
    expect(found.some((entry) => entry.includes('Intro')), 'unaudited *Label prop stays quiet').toBe(false);
  });

  it('passes copy attributes routed through t() and dynamic merchant values', () => {
    const dir = themeDir({
      'blocks/a.tsx': CLIENT(
        `<div><button aria-label={t('cart.title')}>x</button><img alt={product.title} /><input placeholder={hint} /></div>`,
      ),
    });
    expect(noHardcodedStringsRule.run(contextFor(dir))).toEqual([]);
  });

  it('skips decorative text, routes, class-like tokens and strings already inside t()', () => {
    const dir = themeDir({
      'blocks/a.tsx': CLIENT(
        `<div><span>•</span><span>/shop</span><span>ct-card--row</span><span>{t('cart.title')}</span></div>`,
      ),
    });
    expect(noHardcodedStringsRule.run(contextFor(dir))).toEqual([]);
  });
});

describe('kit core snapshot', () => {
  it('is a sorted unique non-empty list of valid locale keys', () => {
    expect(KIT_CORE_KEYS.length).toBeGreaterThan(0);
    expect([...new Set(KIT_CORE_KEYS)]).toHaveLength(KIT_CORE_KEYS.length);
    expect([...KIT_CORE_KEYS].sort()).toEqual(KIT_CORE_KEYS);
    for (const key of KIT_CORE_KEYS) expect(LOCALE_KEY_PATTERN.test(key), key).toBe(true);
    expect(KIT_CORE_SOURCE).toContain('@usequeek/theme-kit');
  });

  it('drifts loudly: the committed kit fixture must equal the snapshot', () => {
    const fromEnv = process.env.KIT_DICTIONARY_PATH;
    const fixture = fileURLToPath(new URL('./fixtures/kit-en.default.json', import.meta.url));
    const candidates = [...(fromEnv ? [fromEnv] : []), fixture];
    let checked = 0;
    for (const path of candidates) {
      const resolved = isAbsolute(path) ? path : join(process.cwd(), path);
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(readFileSync(resolved, 'utf8')) as unknown;
      } catch {
        continue;
      }
      if (parsed === null || typeof parsed !== 'object') continue;
      const keys = flattenLocaleEntries(parsed).leaves.map((leaf) => leaf.key).sort();
      expect(keys, `snapshot drifts from ${resolved}: run scripts/sync-kit-core-strings.mjs`).toEqual(KIT_CORE_KEYS);
      checked += 1;
    }
    expect(checked, 'kit fixture missing: run scripts/sync-kit-core-strings.mjs').toBeGreaterThanOrEqual(1);
  });
});
