import { describe, expect, it } from 'vitest';
import { BUSINESS_KEYS, businessRoot, isBusinessKey } from '../src/utils/business-vocabulary.js';
import { templateBusinessRule, templateDescriptionRule, templatePagesRule, templateVersionsRule } from '../src/rules/static.js';
import type { DemoStore, ThemeContext } from '../src/types.js';

/**
 * The template rules against hand-built contexts — each shown firing on the
 * fault it exists for, not only staying quiet on a healthy theme.
 */

function context(parts: Partial<Pick<ThemeContext, 'demos' | 'declaredDemos' | 'defaultDescription' | 'defaultFor' | 'pageBased'>>): ThemeContext {
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
    manifest: { slug: 'x', variants: {} },
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
