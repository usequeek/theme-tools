import { describe, expect, it } from 'vitest';
import { BUSINESS_KEYS, businessRoot, isBusinessKey } from '../src/utils/business-vocabulary.js';
import { templateBusinessRule, templateCopyRule, templateDescriptionRule, templatePagesRule, templateVersionsRule } from '../src/rules/static.js';
import { copyViolations } from '../src/utils/template-copy.js';
import type { DemoStore, ThemeContext } from '../src/types.js';

/**
 * The template rules against hand-built contexts — each shown firing on the
 * fault it exists for, not only staying quiet on a healthy theme.
 */

function context(parts: Partial<Pick<ThemeContext, 'demos' | 'declaredDemos' | 'defaultDescription' | 'defaultFor' | 'pageBased' | 'manifest'>>): ThemeContext {
  const demos: DemoStore[] = parts.demos ?? [{ id: 'default', file: 'demo.json', data: { pages: {} } }];
  return {
    env: { root: 'theme/', docs: 'https://example.test/THEME.md', vocabulary: 'the vocabulary', scaffold: 'npm create @usequeek/theme', preview: (id) => `http://localhost:3000/${id}`, submission: false },
    slug: 'x',
    dir: '/nowhere/theme',
    retired: false,
    demo: demos[0]?.data ?? null,
    demos,
    declaredDemos: parts.declaredDemos ?? [],
    defaultDescription: parts.defaultDescription ?? null,
    defaultFor: parts.defaultFor ?? null,
    manifest: parts.manifest ?? { slug: 'x', variants: {} },
    pageBased: parts.pageBased ?? true,
    file: (path) => `/nowhere/theme/${path}`,
    exists: () => false,
    read: () => null,
  };
}

describe('business vocabulary', () => {
  it('holds the service slugs and every catalogue root and branch, nothing else', () => {
    expect(isBusinessKey('foods')).toBe(true);
    expect(isBusinessKey('wigs-extensions-hair-accessories')).toBe(true);
    expect(isBusinessKey('jewellery')).toBe(false);
    expect(BUSINESS_KEYS.size).toBeGreaterThan(70);
    expect(businessRoot('shoes')).toBe('fashion');
  });

  it('holds jewelry (under bags-accessories) and beverages, spelled as the categories are', () => {
    expect(isBusinessKey('jewelry')).toBe(true);
    expect(isBusinessKey('beverages')).toBe(true);
    expect(isBusinessKey('coffee')).toBe(false);
    expect(businessRoot('jewelry')).toBe('fashion');
  });
});

describe('theme/template-copy', () => {
  const variants = {
    content: [
      { id: 'steps', fields: { heading: { type: 'string' }, items: { type: 'object[]', of: { title: { type: 'string' }, text: { type: 'text' } } } } },
      { id: 'testimonials', fields: { items: { type: 'object[]', of: { quote: { type: 'text' }, author: { type: 'string' } } } } },
    ],
  };
  const store = (sections: unknown[]): DemoStore => ({ id: 'food', file: 'demos/food.json', data: { profile: { name: 'Ata Kitchen' }, pages: { home: { content: sections } } } });

  it('rejects copy naming the store, a place, a naira amount or a promise', async () => {
    const found = await templateCopyRule.run(context({
      manifest: { slug: 'x', variants } as unknown as ThemeContext['manifest'],
      demos: [store([{ type: 'content', variant: 'steps', data: { heading: 'How Ata Kitchen cooks', items: [{ title: 'Grill', text: 'Free delivery in Yaba over ₦5,000.' }] } }])],
    }));
    expect(found).toHaveLength(1);
    expect(found[0].where).toBe('theme/demos/food.json → pages.home.content[0] (content.steps)');
    expect(found[0].found).toContain('names the store ("Ata Kitchen")');
    expect(found[0].found).toContain('names a place (Yaba); states a naira amount; makes a promise ("Free delivery")');
  });

  it('passes generic copy and leaves testimonials alone', async () => {
    const found = await templateCopyRule.run(context({
      manifest: { slug: 'x', variants } as unknown as ThemeContext['manifest'],
      demos: [store([
        { type: 'content', variant: 'steps', data: { heading: 'How our kitchen cooks', items: [{ title: 'Grill', text: 'Over open fire.' }] } },
        { type: 'content', variant: 'testimonials', data: { items: [{ quote: 'Best suya in Yaba', author: 'Tolu' }] } },
      ])],
    }));
    expect(found).toEqual([]);
    expect(copyViolations('Sourdough fermented for 36 hours', null)).toEqual([]);
    expect(copyViolations('Cooked over open flame since 2014', null)).toEqual(['dates the store ("since 2014")']);
  });
});

describe('theme/template-description', () => {
  it('rejects a missing description, one over 300 characters, and the scaffold placeholder', async () => {
    const found = await templateDescriptionRule.run(context({
      defaultDescription: null,
      declaredDemos: [
        { id: 'long', label: 'L', for: ['foods'], description: 'x'.repeat(301) },
        { id: 'stub', label: 'S', for: ['foods'], description: 'Replace before publishing. Any shop.' },
      ],
    }));
    expect(found.map((f) => f.found)).toEqual([
      'template "default" has no description',
      'template "long" description is 301 chars (max 300)',
      'template "stub" description is still the scaffold\'s placeholder',
    ]);
    expect(found[0].where).toBe('theme/theme.config.ts → default_demo.description');
    expect(found[0].docs).toBe('https://example.test/THEME.md#templates');
  });
});

describe('theme/template-business', () => {
  it('rejects a primary without a business, and keys outside the vocabulary', async () => {
    expect((await templateBusinessRule.run(context({ defaultFor: null }))).map((f) => f.found)).toEqual(['the primary template names no business']);
    const found = await templateBusinessRule.run(context({ defaultFor: ['skincare', 'jewellery'] }));
    expect(found.map((f) => f.found)).toEqual(['template "default" is for "jewellery", not in the business vocabulary']);
    expect(found[0].fix).toContain('the vocabulary');
  });
});

const home = (...slots: string[]) => ({ pages: { home: { content: slots.map((slot) => ({ type: slot.split('/')[0], variant: slot.split('/')[1] })) } } });

describe('theme/template-versions', () => {
  it('rejects two templates with the same home, and a version for another business', async () => {
    const found = await templateVersionsRule.run(context({
      demos: [
        { id: 'default', file: 'demo.json', data: home('gallery/slider', 'products/grid') },
        { id: 'food', file: 'demos/food.json', data: home('gallery/slider', 'products/menu') },
        { id: 'food-2', file: 'demos/food-2.json', data: home('gallery/slider', 'products/grid') },
      ],
      declaredDemos: [{ id: 'food', label: 'F', for: ['foods', 'local-meals'] }, { id: 'food-2', label: 'F2', for: ['foods'] }],
    }));
    expect(found.map((f) => f.found)).toEqual([
      'template "food-2" has the same home sections, in the same order, as "default"',
      'version "food-2" is for ["foods"], "food" for ["foods","local-meals"]',
    ]);
  });
});

describe('theme/template-pages', () => {
  it('rejects a template missing about, sales or landing; exempts a one-page theme', async () => {
    const found = await templatePagesRule.run(context({ demos: [{ id: 'default', file: 'demo.json', data: { pages: { home: { content: [] } } } }] }));
    expect(found.map((f) => f.found)).toEqual([
      'template "default" has no `about` page',
      'template "default" has no `sales` page',
      'template "default" has no `landing` page',
    ]);
    expect(await templatePagesRule.run(context({ pageBased: false, demos: [{ id: 'default', file: 'demo.json', data: { pages: {} } }] }))).toEqual([]);
  });
});
