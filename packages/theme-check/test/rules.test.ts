import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUSINESS_KEYS, businessRoot, isBusinessKey } from '../src/utils/business-vocabulary.js';
import { demoStoresRule, fontsSelfHostedRule, frameworkImport, placeholderContentRule, sdkBoundaryRule, vendorFactsRule, templateBusinessRule, templateCopyRule, templateDescriptionRule, templateDesignsRule, templatePagesRule, templateVersionsRule } from '../src/rules/static.js';
import { copyViolations } from '../src/utils/template-copy.js';
import type { DeclaredDemo, DemoStore, ThemeContext } from '../src/types.js';

/**
 * The template rules against hand-built contexts — each shown firing on the
 * fault it exists for, not only staying quiet on a healthy theme.
 */

function context(parts: Partial<Pick<ThemeContext, 'demos' | 'declaredDemos' | 'defaultDescription' | 'defaultFor' | 'themeDescription' | 'pageBased' | 'manifest' | 'themeConfig'>>): ThemeContext {
  const demos: DemoStore[] = parts.demos ?? [{ id: 'default', file: 'demo.json', data: { pages: {} } }];
  const declaredDemos = parts.declaredDemos ?? [];
  return {
    env: { root: 'theme/', docs: 'https://example.test/THEME.md', vocabulary: 'the vocabulary', scaffold: 'npm create @usequeek/theme', preview: (id) => `http://localhost:3000/${id}`, submission: false },
    slug: 'x',
    dir: '/nowhere/theme',
    retired: false,
    demo: demos[0]?.data ?? null,
    demos,
    themeConfig: parts.themeConfig ?? { default_demo: { for: parts.defaultFor ?? undefined, description: parts.defaultDescription ?? undefined }, demos: declaredDemos },
    declaredDemos,
    defaultDescription: parts.defaultDescription ?? null,
    defaultFor: parts.defaultFor ?? null,
    themeDescription: parts.themeDescription ?? null,
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

describe('theme/template-business order (R2.7)', () => {
  it('rejects a named business category behind a catalogue key; passes general and niche', async () => {
    const found = await templateBusinessRule.run(context({
      defaultFor: ['makeup', 'beauty-cosmetics'],
      declaredDemos: [{ id: 'hair', label: 'Hair', for: ['wigs-extensions-hair-accessories'] }, { id: 'food', label: 'Food', for: ['foods', 'local-meals'] }],
    }));
    expect(found.map((f) => f.found)).toEqual(['template "default" names the business category "beauty-cosmetics" but leads with "makeup"']);
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
    expect(copyViolations('Email hello@zuri.ng to see what we hold.', null)).toEqual(['gives the store’s contact details ("hello@zuri.ng")']);
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
  it("rejects two designs with the same home, and no longer reads an id's -2 (R2.8: theme/template-designs groups)", async () => {
    const found = await templateVersionsRule.run(context({
      demos: [
        { id: 'default', file: 'demo.json', data: home('gallery/slider', 'products/grid') },
        { id: 'food', file: 'demos/food.json', data: home('gallery/slider', 'products/menu') },
        { id: 'food-2', file: 'demos/food-2.json', data: home('gallery/slider', 'products/grid') },
      ],
      declaredDemos: [{ id: 'food', template: 'food', label: 'F', for: ['foods', 'local-meals'] }, { id: 'food-2', template: 'food', label: 'F2', for: ['foods'] }],
    }));
    expect(found.map((f) => f.found)).toEqual([
      'design "food-2" has the same home sections, in the same order, as "default"',
    ]);
  });
});

/* ── R2.8: theme → template → design ─────────────────────────────────── */

type Design = Record<string, unknown>;
/** Medley-shaped (contract R2.8): a main template and a two-design Food template. */
const MAIN: Design = { template: 'beauty', label: 'Skincare & make-up', design_label: 'Photo collage', for: ['beauty-cosmetics', 'makeup'] };
const FOOD: Design = { id: 'food', template: 'food', label: 'Restaurant & kitchen', design_label: 'Dining room', for: ['foods', 'local-meals'] };
const FOOD_2: Design = { id: 'food-2', template: 'food', design_label: 'Neighbourhood buka' };

/** A context declaring these designs, each with its own store on disk named `names[id]` (default "Ata Kitchen"). */
function declaring(main: Design, demos: Design[], names: Record<string, string> = {}): ThemeContext {
  const store = (id: string, file: string): DemoStore => ({ id, file, data: { profile: { name: names[id] ?? 'Ata Kitchen' } } });
  return context({
    themeConfig: { name: 'Medley', default_demo: main, demos },
    declaredDemos: demos as unknown as DeclaredDemo[],
    defaultFor: main.for ?? null,
    demos: [store('default', 'demo.json'), ...demos.map((demo) => store(String(demo.id), `demos/${String(demo.id)}.json`))],
  });
}
const designFindings = async (main: Design, demos: Design[], names?: Record<string, string>): Promise<string[]> =>
  (await templateDesignsRule.run(declaring(main, demos, names))).map((f) => f.found);
const without = (design: Design, key: string): Design => Object.fromEntries(Object.entries(design).filter(([name]) => name !== key));

describe('theme/template-designs', () => {
  it('passes a medley-shaped theme, whose later design leaves out label and for', async () => {
    expect(await designFindings(MAIN, [FOOD, FOOD_2])).toEqual([]);
  });

  it("passes a later design that repeats its template's label and for unchanged (Queek's themes today)", async () => {
    expect(await designFindings(MAIN, [FOOD, { ...FOOD_2, label: FOOD.label, for: FOOD.for }])).toEqual([]);
  });

  it('passes a one-design template without a design_label', async () => {
    expect(await designFindings(without(MAIN, 'design_label'), [{ id: 'hair', template: 'hair', label: 'Wigs & hair', for: ['wigs-extensions-hair-accessories'] }])).toEqual([]);
  });

  it('rejects a main template with no key', async () => {
    const found = await templateDesignsRule.run(declaring(without(MAIN, 'template'), [FOOD, FOOD_2]));
    expect(found.map((f) => f.found)).toEqual(['the main template has no key (default_demo.template)']);
    expect(found[0]).toMatchObject({ rule: 'theme/template-designs', severity: 'reject', where: 'theme/theme.config.ts → default_demo.template', docs: 'https://example.test/THEME.md#templates' });
  });

  it('rejects a design that names no template', async () => {
    const found = await templateDesignsRule.run(declaring(MAIN, [without(FOOD, 'template'), FOOD_2]));
    expect(found.map((f) => f.found)).toEqual(['design "food" names no template']);
    expect(found[0].where).toBe('theme/theme.config.ts → demos[food].template');
  });

  it('rejects a template key that is not a slug, or is "default"', async () => {
    expect(await designFindings(MAIN, [FOOD, { ...FOOD_2, template: 'Food' }])).toEqual(['template key "Food" is not a slug']);
    expect(await designFindings(MAIN, [FOOD, { ...FOOD_2, template: 'default' }])).toEqual(['template key "default" is reserved']);
    expect(await designFindings({ ...MAIN, template: 'default' }, [FOOD, FOOD_2])).toEqual(['template key "default" is reserved']);
  });

  it('rejects a main template key that is also a design id: keys and ids share one namespace', async () => {
    const main = { ...MAIN, template: 'clothes', label: 'Clothing & menswear', for: ['fashion'] };
    expect(await designFindings(main, [{ id: 'clothes', template: 'clothes', design_label: 'Tailoring house' }])).toEqual([
      'the main template\'s key "clothes" is also a design id',
    ]);
  });

  it('rejects a template with no design 1 (no design whose id is its key)', async () => {
    expect(await designFindings(MAIN, [FOOD_2])).toEqual(['template "food" has no design 1 (a design whose id is "food")']);
  });

  it("rejects a later design for another business than its template's", async () => {
    expect(await designFindings(MAIN, [FOOD, { ...FOOD_2, for: ['foods'] }])).toEqual([
      'design "food-2" is for ["foods"], its template "food" for ["foods","local-meals"]',
    ]);
  });

  it('rejects a later design that relabels its template (a legacy composite label)', async () => {
    const found = await templateDesignsRule.run(declaring(MAIN, [FOOD, { ...FOOD_2, label: 'Restaurant & kitchen — neighbourhood buka' }]));
    expect(found.map((f) => f.found)).toEqual([
      'design "food-2" relabels its template ("Restaurant & kitchen — neighbourhood buka"); a design is named by design_label',
    ]);
    expect(found[0].where).toBe('theme/theme.config.ts → demos[food-2].label');
  });

  it('rejects a design of a 2+ design template with no design_label', async () => {
    expect(await designFindings(MAIN, [FOOD, without(FOOD_2, 'design_label')])).toEqual(['design "food-2" has no design_label (template "food" has 2 designs)']);
  });

  it('rejects two designs of a template with one design_label', async () => {
    expect(await designFindings(MAIN, [FOOD, { ...FOOD_2, design_label: 'Dining room' }])).toEqual([
      'designs "food" and "food-2" share the design_label "Dining room"',
    ]);
  });

  it('rejects a design_label that is not true of any store (R2.6 copy rules)', async () => {
    expect(await designFindings(MAIN, [FOOD, { ...FOOD_2, design_label: 'Lekki kitchen' }])).toEqual(['design "food-2" design_label: names a place (Lekki)']);
    expect(await designFindings(MAIN, [FOOD, { ...FOOD_2, design_label: "Mama Tee's buka" }], { 'food-2': "Mama Tee's" })).toEqual([
      'design "food-2" design_label: names the store ("Mama Tee\'s")',
    ]);
    expect(await designFindings(MAIN, [FOOD, { ...FOOD_2, design_label: '₦5,000 trays' }])).toEqual(['design "food-2" design_label: states a naira amount']);
  });

  it('rejects a 4th design of one template (R2.2 allows three)', async () => {
    const third: Design = { id: 'food-3', template: 'food', design_label: 'Grill house' };
    const found = await templateDesignsRule.run(declaring(MAIN, [FOOD, FOOD_2, third, { id: 'food-4', template: 'food', design_label: 'Night market' }]));
    expect(found.map((f) => f.found)).toEqual(['template "food" has 4 designs; a template has at most 3']);
    expect(found[0].where).toBe('theme/theme.config.ts → demos[food-4].template');
    expect(await designFindings(MAIN, [FOOD, FOOD_2, third])).toEqual([]);
  });

  it('exempts a retired theme', async () => {
    expect(await templateDesignsRule.run({ ...declaring(without(MAIN, 'template'), [FOOD_2]), retired: true })).toEqual([]);
  });
});

describe('theme/demo-stores (R2.8)', () => {
  it("asks label and for of a template's design 1 only; a later design inherits them", async () => {
    const found = await demoStoresRule.run(declaring(MAIN, [without(FOOD, 'label'), FOOD_2]));
    expect(found.map((f) => f.found)).toEqual(['demos[] "food" has no label']);
  });

  it('shows the whole declaration, template included, for an undeclared file', async () => {
    const ctx = declaring(MAIN, [FOOD]);
    const found = await demoStoresRule.run({ ...ctx, demos: [...ctx.demos, { id: 'food-2', file: 'demos/food-2.json', data: {} }] });
    expect(found.map((f) => f.fix)).toEqual([expect.stringContaining("`{ id: 'food-2', template, label, for, description }`")]);
  });
});

describe('theme/template-business (R2.8)', () => {
  it("checks each template's for once, by its design 1", async () => {
    const found = await templateBusinessRule.run(declaring(MAIN, [{ ...FOOD, for: ['jewellery'] }, { ...FOOD_2, for: ['jewellery'] }]));
    expect(found.map((f) => [f.found, f.where])).toEqual([
      ['template "food" is for "jewellery", not in the business vocabulary', 'theme/theme.config.ts → demos[food].for'],
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

describe('theme/vendor-facts', () => {
  it("rejects a vendor fact with a worded fallback, allows an empty one", async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vendor-facts-'));
    writeFileSync(join(dir, 'footer.tsx'), "<span>{vendor.address ?? 'Lagos, Nigeria'}</span>");
    const found = await vendorFactsRule.run({ ...context({}), dir });
    expect(found.map((f) => f.found)).toEqual(['vendor.address falls back to "Lagos, Nigeria"']);
    writeFileSync(join(dir, 'footer.tsx'), "<span>{vendor.address ?? ''}</span>");
    expect(await vendorFactsRule.run({ ...context({}), dir })).toEqual([]);
  });
});

describe('theme/placeholder-content', () => {
  const store = (products: Array<{ slug: string; media?: unknown }>): DemoStore => ({ id: 'default', file: 'demo.json', data: { profile: { id: 'demo-x' }, products, pages: {} } });

  it("rejects the starter's placeholder products and photos", async () => {
    const found = await placeholderContentRule.run(context({ demos: [store([
      { slug: 'placeholder-one', media: { image: 'https://media.usequeek.com/theme-assets/_bare/0c8749c67b449815.jpg' } },
      { slug: 'real-dress' },
    ])] }));
    expect(found).toHaveLength(1);
    expect(found[0].found).toBe("1 placeholder product(s) and 1 of the starter's photos");
  });

  it("passes a store with the developer's own products", async () => {
    expect(await placeholderContentRule.run(context({ demos: [store([{ slug: 'real-dress', media: { image: 'https://example.test/dress.jpg' } }])] }))).toEqual([]);
  });

  it("rejects a theme description that is still the starter's placeholder", async () => {
    const found = await placeholderContentRule.run(context({ demos: [store([{ slug: 'real-dress' }])], themeDescription: 'Replace before publishing. What this theme is, in one sentence.' }));
    expect(found.map((f) => [f.where, f.found, f.severity])).toEqual([
      ['theme/theme.config.ts → description', "the theme's description is still the starter's placeholder", 'reject'],
    ]);
    expect(found[0].docs).toBe('https://example.test/THEME.md#placeholder-content');
  });

  it("passes the theme's own description, the skeleton's included", async () => {
    for (const themeDescription of ['A dark, photo-led theme for restaurants.', 'The starting skeleton for a new theme — the contract with no design opinions. Never published.', null]) {
      expect(await placeholderContentRule.run(context({ demos: [store([{ slug: 'real-dress' }])], themeDescription }))).toEqual([]);
    }
  });

  it("passes a store using lumiere's original photos", async () => {
    expect(await placeholderContentRule.run(context({ demos: [store([{ slug: 'real-dress', media: { image: 'https://media.usequeek.com/theme-assets/lumiere/0c8749c67b449815.jpg' } }])] }))).toEqual([]);
  });
});

describe('theme/core-boundary: the framework stays behind the kit', () => {
  it('finds every way a theme can import Next', () => {
    expect(frameworkImport("import Link from 'next/link';")).toBe('next/link');
    expect(frameworkImport('import { useRouter } from "next/navigation";')).toBe('next/navigation');
    expect(frameworkImport("import Image from 'next/image';")).toBe('next/image');
    expect(frameworkImport("import { headers } from 'next/headers';")).toBe('next/headers');
    expect(frameworkImport("import type { Metadata } from 'next';")).toBe('next');
    expect(frameworkImport("import 'next/font';")).toBe('next/font');
    expect(frameworkImport("const Map = dynamic(() => import('next/dynamic'));")).toBe('next/dynamic');
    expect(frameworkImport("const link = require('next/link');")).toBe('next/link');
  });

  it("leaves the kit's navigation and look-alike packages alone", () => {
    expect(frameworkImport("import { Link, useRouter } from '@usequeek/theme-kit/navigation';")).toBeNull();
    expect(frameworkImport("import { useTranslations } from 'next-intl';")).toBeNull();
    expect(frameworkImport("import x from './next/link';")).toBeNull();
    expect(frameworkImport('// the next step is the cart')).toBeNull();
  });

  it('rejects a theme file that imports next/link, naming the file and the fix', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'boundary-'));
    writeFileSync(join(dir, 'header.tsx'), "'use client';\nimport Link from 'next/link';\nexport const Header = () => <Link href=\"/\">Home</Link>;\n");
    writeFileSync(join(dir, 'footer.tsx'), "import { Link } from '@usequeek/theme-kit/navigation';\nexport const Footer = () => <Link href=\"/\">Home</Link>;\n");

    const findings = await sdkBoundaryRule.run({ ...context({}), dir });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ rule: 'theme/core-boundary', severity: 'reject', where: 'header.tsx' });
    expect(findings[0].found).toContain("'next/link'");
    expect(findings[0].fix).toContain('@usequeek/theme-kit/navigation');
  });
});

describe('theme/fonts-self-hosted', () => {
  it('rejects a Google Fonts @import in a theme stylesheet, same as next/font/google', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fonts-rule-'));
    mkdirSync(join(dir, 'styles'), { recursive: true });
    writeFileSync(join(dir, 'styles/type.css'), "@import url('https://fonts.googleapis.com/css2?family=Jost&display=swap');\n");

    const findings = await fontsSelfHostedRule.run({ ...context({}), dir });

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'theme/fonts-self-hosted',
      severity: 'reject',
      where: 'styles/type.css',
      found: 'loads a font with @import from fonts.googleapis.com',
    });
  });
});
