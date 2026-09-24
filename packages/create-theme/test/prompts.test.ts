import { describe, expect, it } from 'vitest';
import { NICHES, SERVICES } from '../src/lists.js';
import { askUntil, templateOptions } from '../src/prompts.js';

describe('askUntil', () => {
  it('asks again from the last answer, warning each time, until the answer has no problem', async () => {
    const answers = [['a', 'b', 'c', 'd', 'e', 'f', 'g'], [], ['a']];
    const seen: Array<string[] | undefined> = [];
    const warnings: string[] = [];
    const picked = await askUntil<string[]>(
      async (previous) => { seen.push(previous); return answers.shift()!; },
      (tags) => (tags.length < 1 || tags.length > 6 ? 'Pick 1 to 6 tags.' : undefined),
      (message) => warnings.push(message),
    );
    expect(picked).toEqual(['a']);
    expect(warnings).toEqual(['Pick 1 to 6 tags.', 'Pick 1 to 6 tags.']);
    expect(seen).toEqual([undefined, ['a', 'b', 'c', 'd', 'e', 'f', 'g'], []]);
  });
});

describe('the templates question', () => {
  const options = templateOptions();

  it('lists the business categories first, then the niches', () => {
    expect(options.map((option) => option.value)).toEqual([...SERVICES, ...NICHES]);
    expect(options.slice(0, SERVICES.length).every((option) => option.hint === 'business category')).toBe(true);
  });

  it("names a niche's business category in its hint, catalogue roots included", () => {
    const hint = (key: string) => options.find((option) => option.value === key)?.hint;
    expect(hint('jewelry')).toBe('niche · Fashion');
    expect(hint('beauty-personal-care')).toBe('niche · Beauty & cosmetics');
    expect(hint('laundry')).toBe('business category');
  });
});
