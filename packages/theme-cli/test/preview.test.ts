import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { groupStores } from '../preview/app/_lib/group-stores.js';
import { designsModule, writePreview } from '../src/lib/preview.js';

/** Medley-shaped (contract R2.8), with a design declared before its template's design 1. */
const MEDLEY = {
  name: 'Medley',
  default_demo: { template: 'beauty', label: 'Skincare & make-up', design_label: 'Photo collage', for: ['beauty-cosmetics'] },
  demos: [
    { id: 'clothes', template: 'clothes', label: 'Clothing & menswear', design_label: 'Campaign', for: ['fashion'] },
    { id: 'food-2', template: 'food', design_label: 'Neighbourhood buka' },
    { id: 'food', template: 'food', label: 'Restaurant & kitchen', design_label: 'Dining room', for: ['foods', 'local-meals'] },
    { id: 'clothes-2', template: 'clothes', design_label: 'Tailoring house' },
    { id: 'hair', template: 'hair', label: 'Wigs & hair', for: ['wigs-extensions-hair-accessories'] },
  ],
};
const FILES = ['clothes', 'clothes-2', 'food', 'food-2', 'hair'];

describe('the dev preview groups stores by template (R2.8)', () => {
  it('lists each template once, the main one first, its design 1 first, each design by its design_label', () => {
    expect(groupStores(MEDLEY, FILES)).toEqual([
      { key: 'beauty', label: 'Skincare & make-up', designs: [{ id: 'default', label: 'Photo collage', declared: true }] },
      { key: 'clothes', label: 'Clothing & menswear', designs: [{ id: 'clothes', label: 'Campaign', declared: true }, { id: 'clothes-2', label: 'Tailoring house', declared: true }] },
      { key: 'food', label: 'Restaurant & kitchen', designs: [{ id: 'food', label: 'Dining room', declared: true }, { id: 'food-2', label: 'Neighbourhood buka', declared: true }] },
      { key: 'hair', label: 'Wigs & hair', designs: [{ id: 'hair', label: 'Wigs & hair', declared: true }] },
    ]);
  });

  it('lists an undeclared file on its own with declared: false, and leaves out a declared design with no file', () => {
    const grouped = groupStores(MEDLEY, ['clothes', 'food', 'food-2', 'hair', 'x']);
    expect(grouped.find((template) => template.key === 'clothes')?.designs.map((design) => design.id)).toEqual(['clothes']);
    expect(grouped.at(-1)).toEqual({ key: 'x', label: 'x', designs: [{ id: 'x', label: 'x', declared: false }] });
  });

  it('still lists a config written before R2.8: every design its own template, the main one by the theme name', () => {
    const legacy = { name: 'Old', demos: [{ id: 'food', label: 'Food', for: ['foods'] }, { id: 'food-2', label: 'Food — grill', for: ['foods'] }] };
    expect(groupStores(legacy, ['food', 'food-2'])).toEqual([
      { key: null, label: 'Old', designs: [{ id: 'default', label: 'Old', declared: true }] },
      { key: 'food', label: 'Food', designs: [{ id: 'food', label: 'Food', declared: true }] },
      { key: 'food-2', label: 'Food — grill', designs: [{ id: 'food-2', label: 'Food — grill', declared: true }] },
    ]);
  });
});

describe('writePreview', () => {
  const root = mkdtempSync(join(tmpdir(), 'queek-preview-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('copies the design resolver into the preview, so the preview never imports theme-check', () => {
    mkdirSync(join(root, 'theme'));
    const dir = writePreview({ root, themeDir: join(root, 'theme') });
    const designs = readFileSync(join(dir, 'designs.js'), 'utf8');
    expect(designs.endsWith(designsModule())).toBe(true);
    expect(designs).toContain('export function designsOf(');
    expect(designs).not.toMatch(/^\s*(import|export .* from) /m);
    expect(readFileSync(join(dir, 'app/_lib/group-stores.js'), 'utf8')).toContain("from '../../designs'");

    const sources = (folder: string): string[] => readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? sources(join(folder, entry.name)) : entry.name.endsWith('.js') ? [join(folder, entry.name)] : []);
    expect(sources(dir).filter((file) => readFileSync(file, 'utf8').includes('@usequeek/theme-check'))).toEqual([]);
  });
});
