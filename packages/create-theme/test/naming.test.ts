import { describe, expect, it } from 'vitest';
import { defaultCategories, planTemplates, prefixFor, slugProblem, slugify } from '../src/naming.js';

describe('slugify', () => {
  it('folds accents and punctuation into a kebab slug', () => {
    expect(slugify('Mọ́ Laundry & Co.')).toBe('mo-laundry-co');
    expect(slugify('  Ìrì  Skin  ')).toBe('iri-skin');
  });

  it('starts with a letter and stays within 31 characters', () => {
    expect(slugify('24 Seven')).toBe('t-24-seven');
    expect(slugify('A very long theme name that goes on and on and on').length).toBeLessThanOrEqual(31);
    expect(slugify('A very long theme name that goes on and on and on')).not.toMatch(/-$/);
  });

  it('returns empty string on degenerate input (only punctuation)', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('slugProblem', () => {
  it("accepts a slug theme:pull accepts, and refuses Queek's own", () => {
    expect(slugProblem('mo-laundry')).toBeNull();
    expect(slugProblem('medley')).toBe('"medley" is one of Queek\'s own themes. Choose another name.');
    expect(slugProblem('x')).toMatch(/2 to 31/);
  });

  it('rejects empty slug', () => {
    expect(slugProblem('')).toMatch(/2 to 31/);
  });
});

describe('prefixFor', () => {
  it("uses the slug's initials, and never a Queek theme's prefix", () => {
    expect(prefixFor('mo-laundry-co')).toBe('mlc');
    expect(prefixFor('medium')).not.toBe('md');
    expect(prefixFor('medium')).toMatch(/^[a-z][a-z0-9]{1,3}$/);
  });

  it('throws on invalid slug', () => {
    expect(() => prefixFor('')).toThrow('prefixFor needs a valid slug');
  });
});

describe('planTemplates', () => {
  it('puts the main template first as default, the rest under their key, without duplicates; each template keyed by its business (R2.8)', () => {
    expect(planTemplates(['foods', 'laundry', 'foods'], 'laundry')).toEqual([
      { id: 'default', key: 'laundry', template: 'laundry', label: 'Laundry & dry cleaning', for: ['laundry'], primary: true },
      { id: 'foods', key: 'foods', template: 'foods', label: 'Food & restaurants', for: ['foods'], primary: false },
    ]);
  });

  it('keeps a niche template niche: no business category in its for (R2.7)', () => {
    expect(planTemplates(['wigs-extensions-hair-accessories'])[0].for).toEqual(['wigs-extensions-hair-accessories']);
  });

  it('returns empty array when keys is empty', () => {
    expect(planTemplates([])).toEqual([]);
  });
});

describe('defaultCategories', () => {
  it("is each template's business category, once", () => {
    expect(defaultCategories(['wigs-extensions-hair-accessories', 'makeup', 'laundry'])).toEqual(['beauty-cosmetics', 'laundry']);
  });
});
