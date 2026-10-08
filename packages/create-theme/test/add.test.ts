import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { designsOf, groupTemplates, loadContext } from '@usequeek/theme-check';
import { applyAddPlan, planAddDesign, planAddPage, planAddTemplate } from '../src/add.js';
import { appendDemoEntry, setDesignLabel } from '../src/config-edit.js';
import { UsageError } from '../src/options.js';
import { FIXTURE_THEME } from './helpers.js';

const SKELETON_STORE = resolve(import.meta.dirname, '../src/data/skeleton-store.json');
const STARTER_DEMO = resolve(import.meta.dirname, '../../../fixtures/starter/theme/demo.json');
/** A hand-edited theme config (the medley theme's): the fixture the AST edits prove themselves on. */
const MEDLEY_FIXTURE = resolve(import.meta.dirname, '../../../fixtures/medley-theme.config.ts');

/** Added vs removed lines (LCS): small files only, no `diff` binary. */
function diffLines(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split('\n');
  const b = after.split('\n');
  const longest: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      longest[i]![j] = a[i] === b[j] ? longest[i + 1]![j + 1]! + 1 : Math.max(longest[i + 1]![j]!, longest[i]![j + 1]!);
    }
  }
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; } else if (longest[i + 1]![j]! >= longest[i]![j + 1]!) removed.push(a[i++]!);
    else added.push(b[j++]!);
  }
  while (i < a.length) removed.push(a[i++]!);
  while (j < b.length) added.push(b[j++]!);
  return { removed, added };
}

/** A copy of the starter theme (slug `bare`), as a developer's project. */
function stageTheme(): string {
  const dir = mkdtempSync(join(tmpdir(), 'add-test-'));
  cpSync(FIXTURE_THEME, join(dir, 'theme'), { recursive: true });
  return join(dir, 'theme');
}

const themeFile = (themeDir: string, path: string): string => readFileSync(join(themeDir, path), 'utf8');

async function usageError(promise: Promise<unknown>): Promise<UsageError> {
  const error = await promise.catch((error: unknown) => error);
  expect(error).toBeInstanceOf(UsageError);
  expect((error as UsageError).exitCode).toBe(2);
  return error as UsageError;
}

describe('bundled skeleton store', () => {
  it('matches fixtures/starter byte for byte — add builds from the same copy create downloads', () => {
    expect(themeFile(resolve(SKELETON_STORE, '..'), 'skeleton-store.json')).toBe(readFileSync(STARTER_DEMO, 'utf8'));
  });
});

describe('config edits', () => {
  const starter = () => themeFile(FIXTURE_THEME, 'theme.config.ts');
  const medley = () => readFileSync(MEDLEY_FIXTURE, 'utf8');
  const entry = {
    id: 'jewelry', template: 'jewelry', label: 'Jewelry', for: ['jewelry'],
    description: 'Replace before publishing. Who this template fits, the look, its signature sections and the photos it needs, in at most 300 characters.',
  };

  it('appends a demos[] entry to the starter config, changing nothing else', () => {
    const { removed, added } = diffLines(starter(), appendDemoEntry(starter(), entry));
    expect(removed).toEqual([]);
    expect(added.length).toBeGreaterThan(0);
    expect(added.join('\n')).toContain("id: 'jewelry'");
  });

  it('appends a demos[] entry to the hand-edited medley config, changing nothing else', () => {
    const { removed, added } = diffLines(medley(), appendDemoEntry(medley(), entry));
    expect(removed).toEqual([]);
    expect(added.join('\n')).toContain("id: 'jewelry'");
  });

  it('adds design_label where one is missing, changing nothing else', () => {
    const { removed, added } = diffLines(starter(), setDesignLabel(starter(), 'default', 'General store'));
    expect(removed).toEqual([]);
    expect(added.join('\n')).toContain("design_label: 'General store'");
  });

  it('replaces design_label where one exists, changing only that line', () => {
    const { removed, added } = diffLines(medley(), setDesignLabel(medley(), 'clothes', 'New look'));
    expect(removed).toHaveLength(1);
    expect(added).toHaveLength(1);
    expect(removed[0]).toContain("design_label: 'Campaign'");
    expect(added[0]).toContain("design_label: 'New look'");
  });

  it('refuses an unknown design id', async () => {
    expect(() => setDesignLabel(medley(), 'no-such-design', 'X')).toThrow(UsageError);
  });

  // A Windows checkout (and many Windows editors) writes CRLF. The edit must land in
  // the same place and keep the file's own line endings — Windows CI caught a
  // CRLF config getting its neighbouring lines rewritten.
  it('edits a CRLF config exactly as it edits the LF one, keeping CRLF', () => {
    const crlf = (text: string): string => text.replace(/\r?\n/g, '\r\n');
    const lf = (text: string): string => text.replace(/\r\n/g, '\n');
    for (const source of [lf(starter()), lf(medley())]) {
      expect(appendDemoEntry(crlf(source), entry)).toBe(crlf(appendDemoEntry(source, entry)));
    }
    expect(setDesignLabel(crlf(lf(starter())), 'default', 'General store')).toBe(crlf(setDesignLabel(lf(starter()), 'default', 'General store')));
    expect(setDesignLabel(crlf(lf(medley())), 'clothes', 'New look')).toBe(crlf(setDesignLabel(lf(medley()), 'clothes', 'New look')));
  });
});

describe('planAddTemplate', () => {
  it('adds a template built like create builds one: fresh shop ids, the primary\u2019s pages, a declared design 1', async () => {
    const themeDir = stageTheme();
    const before = themeFile(themeDir, 'theme.config.ts');
    const plan = await planAddTemplate(themeDir, { business: 'jewelry' });
    expect(plan.added).toEqual({ type: 'template', template: 'jewelry', id: 'jewelry', label: 'Jewelry', for: ['jewelry'] });
    applyAddPlan(plan);

    const store = JSON.parse(themeFile(themeDir, 'demos/jewelry.json')) as {
      profile: { id: string }; products: Array<{ shop_id: string }>; pages: Record<string, { id: string }>; menus: Array<{ items: Array<{ type: string; ref?: string }> }>;
    };
    expect(store.profile.id).toBe('demo-bare-jewelry');
    expect(new Set(store.products.map((product) => product.shop_id))).toEqual(new Set(['demo-bare-jewelry']));
    expect(Object.keys(store.pages).sort()).toEqual(['about', 'contact', 'faq', 'home', 'landing', 'sales', 'shop']);
    expect(store.pages.contact!.id).toBe('demo-bare-jewelry-contact');

    const { removed, added } = diffLines(before, themeFile(themeDir, 'theme.config.ts'));
    expect(removed).toEqual([]);
    expect(added.join('\n')).toContain("template: 'jewelry'");

    // And the edited config still loads, with the new template grouped by its explicit key.
    const context = await loadContext(themeDir);
    const jewelry = groupTemplates(designsOf({ ...(context.themeConfig as Record<string, unknown>), demos: context.declaredDemos ?? [] }))
      .find((template) => template.key === 'jewelry');
    expect(jewelry?.designs.map((design) => design.id)).toEqual(['jewelry']);
  });

  it('honours --label', async () => {
    const themeDir = stageTheme();
    const plan = await planAddTemplate(themeDir, { business: 'jewelry', label: 'Fine jewelry' });
    expect(plan.added).toMatchObject({ label: 'Fine jewelry' });
  });

  it('refuses an unknown business, suggesting the nearest', async () => {
    const error = await usageError(planAddTemplate(stageTheme(), { business: 'jewellery' }));
    expect(error.message).toContain('did you mean "jewelry"');
  });

  it('refuses a template that already exists', async () => {
    const themeDir = stageTheme();
    applyAddPlan(await planAddTemplate(themeDir, { business: 'jewelry' }));
    const error = await usageError(planAddTemplate(themeDir, { business: 'jewelry' }));
    expect(error.message).toContain('already exists');
  });
});

describe('planAddDesign', () => {
  async function withTemplate(): Promise<string> {
    const themeDir = stageTheme();
    applyAddPlan(await planAddTemplate(themeDir, { business: 'jewelry' }));
    return themeDir;
  }

  it('copies design 1 with fresh ids and names both designs', async () => {
    const themeDir = await withTemplate();
    const plan = await planAddDesign(themeDir, { template: 'jewelry', label: 'Second look', firstLabel: 'Main' });
    expect(plan.added).toMatchObject({ type: 'design', template: 'jewelry', id: 'jewelry-2', design_label: 'Second look' });
    applyAddPlan(plan);

    const copy = JSON.parse(themeFile(themeDir, 'demos/jewelry-2.json')) as { profile: { id: string }; products: Array<{ shop_id: string }> };
    expect(copy.profile.id).toBe('demo-bare-jewelry-2');
    expect(new Set(copy.products.map((product) => product.shop_id))).toEqual(new Set(['demo-bare-jewelry-2']));

    const config = themeFile(themeDir, 'theme.config.ts');
    expect(config).toContain("design_label: 'Main'");
    expect(config).toContain("id: 'jewelry-2'");
  });

  it('suggests -2, then -3, and needs no first label once design 1 has one', async () => {
    const themeDir = await withTemplate();
    applyAddPlan(await planAddDesign(themeDir, { template: 'jewelry', label: 'Second look', firstLabel: 'Main' }));
    const plan = await planAddDesign(themeDir, { template: 'jewelry', label: 'Third look' });
    expect(plan.added).toMatchObject({ id: 'jewelry-3' });
  });

  it('refuses a 4th design of one template', async () => {
    const themeDir = await withTemplate();
    applyAddPlan(await planAddDesign(themeDir, { template: 'jewelry', label: 'Second look', firstLabel: 'Main' }));
    applyAddPlan(await planAddDesign(themeDir, { template: 'jewelry', label: 'Third look' }));
    const error = await usageError(planAddDesign(themeDir, { template: 'jewelry', label: 'Fourth look' }));
    expect(error.message).toContain('at most 3');
  });

  it('requires --first-label when design 1 has none', async () => {
    const error = await usageError(planAddDesign(await withTemplate(), { template: 'jewelry', label: 'Second look' }));
    expect(error.message).toContain('--first-label');
  });

  it('requires --label', async () => {
    const error = await usageError(planAddDesign(await withTemplate(), { template: 'jewelry', firstLabel: 'Main' }));
    expect(error.message).toContain('--label');
  });

  it('refuses an unknown template', async () => {
    const error = await usageError(planAddDesign(stageTheme(), { template: 'no-such-template', label: 'X' }));
    expect(error.message).toContain('Unknown template');
  });
});

describe('planAddPage', () => {
  it("adds the skeleton's page with the store's ids, plus its menu item", async () => {
    const themeDir = stageTheme();
    // Drop faq the way create would when it is not chosen.
    const demo = JSON.parse(themeFile(themeDir, 'demo.json')) as {
      pages: Record<string, unknown>; menus: Array<{ location?: string; items: Array<{ type?: string; ref?: string }> }>;
    };
    delete demo.pages.faq;
    for (const menu of demo.menus) menu.items = menu.items.filter((item) => item.ref !== 'faq');
    writeFileSync(join(themeDir, 'demo.json'), `${JSON.stringify(demo, null, 2)}\n`);

    const plan = await planAddPage(themeDir, { page: 'faq' });
    expect(plan.added).toEqual({ type: 'page', page: 'faq', design: 'default' });
    applyAddPlan(plan);

    const store = JSON.parse(themeFile(themeDir, 'demo.json')) as {
      pages: Record<string, { id: string }>; menus: Array<{ items: Array<{ label?: string; type?: string; ref?: string }> }>;
    };
    expect(store.pages.faq!.id).toBe('demo-bare-faq');
    expect(store.menus.flatMap((menu) => menu.items)).toContainEqual({ label: 'FAQ', type: 'page', ref: 'faq' });
  });

  it('adds to the --template template\u2019s design', async () => {
    const themeDir = stageTheme();
    applyAddPlan(await planAddTemplate(themeDir, { business: 'jewelry' }));
    const jewelry = JSON.parse(themeFile(themeDir, 'demos/jewelry.json')) as { pages: Record<string, unknown> };
    delete jewelry.pages.faq;
    writeFileSync(join(themeDir, 'demos/jewelry.json'), `${JSON.stringify(jewelry, null, 2)}\n`);

    const plan = await planAddPage(themeDir, { page: 'faq', template: 'jewelry' });
    expect(plan.added).toEqual({ type: 'page', page: 'faq', design: 'jewelry' });
    applyAddPlan(plan);
    expect(Object.keys(JSON.parse(themeFile(themeDir, 'demos/jewelry.json')).pages)).toContain('faq');
  });

  it('refuses a page the store already has', async () => {
    const error = await usageError(planAddPage(stageTheme(), { page: 'contact' }));
    expect(error.message).toContain('already has a contact page');
  });

  it('refuses an unknown template', async () => {
    const error = await usageError(planAddPage(stageTheme(), { page: 'contact', template: 'no-such-template' }));
    expect(error.message).toContain('Unknown template');
  });

  it('refuses an unknown page', async () => {
    const error = await usageError(planAddPage(stageTheme(), { page: 'blog' }));
    expect(error.message).toContain('Unknown page');
  });
});

describe('dry-run', () => {
  it('plans without writing', async () => {
    const themeDir = stageTheme();
    const plan = await planAddTemplate(themeDir, { business: 'jewelry' });
    expect(plan.files).toHaveLength(2);
    expect(existsSync(join(themeDir, 'demos/jewelry.json'))).toBe(false);
    expect(themeFile(themeDir, 'theme.config.ts')).not.toContain('jewelry');
    rmSync(themeDir, { recursive: true, force: true });
  });
});
