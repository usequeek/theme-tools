import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUSINESS_KEYS, NICHES, SERVICES, TAGS, categoryOf, labelOf, nearest } from '../src/lists.js';

describe('bundled lists', () => {
  it('bundle the same vocabulary the checker enforces', () => {
    const create = readFileSync(new URL('../src/data/business-vocabulary.json', import.meta.url), 'utf8');
    const check = readFileSync(new URL('../../theme-check/src/utils/business-vocabulary.json', import.meta.url), 'utf8');
    expect(create).toBe(check);
  });

  it('label every key', () => {
    for (const key of BUSINESS_KEYS) expect(labelOf(key), key).not.toBe(key);
  });

  it('split business categories from niches', () => {
    expect(SERVICES).toContain('laundry');
    expect(NICHES).toEqual(expect.arrayContaining(['jewelry', 'wigs-extensions-hair-accessories', 'beauty-personal-care']));
    expect(NICHES).not.toContain('fashion');
    expect(TAGS).toContain('minimal');
  });

  it('map any key to the business category a vendor picks at setup', () => {
    expect(categoryOf('laundry')).toBe('laundry');
    expect(categoryOf('jewelry')).toBe('fashion');
    expect(categoryOf('wigs-extensions-hair-accessories')).toBe('beauty-cosmetics');
    expect(categoryOf('beauty-personal-care')).toBe('beauty-cosmetics');
    expect(categoryOf('phones-tablets')).toBe('phones-accessories');
    expect(categoryOf('health-wellness')).toBe('health-wellness-store');
    expect(categoryOf('smartphones')).toBe('phones-accessories');
    expect(categoryOf('vitamins-supplements')).toBe('health-wellness-store');
  });

  it('suggest the nearest key, or nothing', () => {
    expect(nearest('jewellery', BUSINESS_KEYS)).toBe('jewelry');
    expect(nearest('xyzzy-plugh', BUSINESS_KEYS)).toBeNull();
  });
});
