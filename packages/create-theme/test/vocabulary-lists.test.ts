import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runCreate } from '../src/index.js';
import { bundledLists, createLists, getActiveLists, SHOP_HINT, SHOP_LABEL } from '../src/lists.js';
import { resolveAnswers, type Flags } from '../src/options.js';
import { starterProject } from './helpers.js';

/**
 * The live vocabulary in create-theme, without the network: prompts read the
 * cached-or-bundled copy, the final `for` is rechecked against the fresh one.
 * The global fetch throws here, so any run that reaches for the real network
 * fails instead of hitting production.
 */

const calls: unknown[] = [];
const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = ((...args: unknown[]) => {
    calls.push(args);
    throw new Error('network in tests');
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

const flags = (dir: string, overrides: Partial<Flags> = {}): Flags => ({
  dir, template: starterProject(), templates: 'laundry', tags: 'minimal',
  install: false, git: false, yes: true, dryRun: false, force: false, offline: true, ...overrides,
});

describe('createLists from one vocabulary copy', () => {
  const lists = createLists({
    services: ['laundry', 'shop'],
    catalogue: { 'hair-care': ['wigs'] },
    subcategories: {},
    root_service: { 'hair-care': 'laundry' },
    labels: { laundry: 'Laundry', shop: 'Shop', 'hair-care': 'Hair Care', wigs: 'Wigs' },
  });

  it('reads root→service and labels from the copy, with no hand-kept maps', () => {
    expect(lists.categoryOf('hair-care')).toBe('laundry');
    expect(lists.categoryOf('wigs')).toBe('laundry');
    expect(lists.categoryOf('laundry')).toBe('laundry');
    expect(lists.labelOf('wigs')).toBe('Wigs');
    expect(lists.labelOf('unknown-key')).toBe('unknown-key');
  });

  it('lists shop dead last as "General store" with its hint', () => {
    const options = lists.templateOptions();
    expect(options.at(-1)).toMatchObject({ value: 'shop', label: SHOP_LABEL, hint: SHOP_HINT });
    expect(options.map((option) => option.value)).toEqual(['laundry', 'hair-care', 'wigs', 'shop']);
    expect(lists.categoryOptions().at(-1)).toMatchObject({ value: 'shop', label: SHOP_LABEL, hint: SHOP_HINT });
  });

  it('validates answers against the injected copy', async () => {
    await expect(resolveAnswers({ ...flags('x-theme'), templates: 'shop', offline: false }, null, undefined, lists)).resolves.toMatchObject({ slug: 'x-theme' });
    await expect(resolveAnswers({ ...flags('x-theme'), templates: 'foods' }, null, undefined, lists)).rejects.toThrow('Unknown business "foods"');
  });
});

describe('bundled lists', () => {
  it('order shop last and label it "General store"', () => {
    const lists = bundledLists();
    expect(lists.services.at(-1)).toBe('shop');
    expect(lists.businessKeys.at(-1)).toBe('shop');
    expect(lists.templateOptions().at(-1)).toMatchObject({ value: 'shop', label: 'General store' });
    expect(getActiveLists().templateOptions().at(-1)?.value).toBe('shop');
  });
});

describe('runCreate vocabulary flags', () => {
  it('--offline creates from the bundled copy without touching the network', async () => {
    const before = calls.length;
    const dir = join(mkdtempSync(join(tmpdir(), 'create-vocab-')), 'my-theme');
    await runCreate(flags(dir), null, () => {});
    expect(existsSync(join(dir, 'theme/theme.config.ts'))).toBe(true);
    expect(readFileSync(join(dir, 'theme/theme.config.ts'), 'utf8')).toContain("for: ['laundry']");
    expect(calls.length).toBe(before);
  });

  it('--vocabulary pins the prompts to a file, and rejects keys outside it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'create-vocab-'));
    const file = join(dir, 'vocab.json');
    writeFileSync(file, JSON.stringify({
      version: 'test',
      services: ['laundry'],
      catalogue: {},
      subcategories: {},
      labels: { laundry: 'Laundry' },
    }));
    const out = join(mkdtempSync(join(tmpdir(), 'create-vocab-')), 'my-theme');
    await runCreate(flags(out, { offline: false, vocabularyFile: file }), null, () => {});
    expect(readFileSync(join(out, 'theme/theme.config.ts'), 'utf8')).toContain("for: ['laundry']");

    const out2 = join(mkdtempSync(join(tmpdir(), 'create-vocab-')), 'my-theme');
    await expect(runCreate(flags(out2, { offline: false, vocabularyFile: file, templates: 'foods' }), null, () => {})).rejects.toThrow('Unknown business "foods"');
  });

  it('--vocabulary with junk is a usage error, never a silent fallback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'create-vocab-'));
    const file = join(dir, 'junk.json');
    writeFileSync(file, JSON.stringify({ services: [] }));
    const out = join(mkdtempSync(join(tmpdir(), 'create-vocab-')), 'my-theme');
    await expect(runCreate(flags(out, { offline: false, vocabularyFile: file }), null, () => {})).rejects.toThrow('--vocabulary');
  });
});
