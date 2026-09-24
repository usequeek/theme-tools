import { describe, expect, it } from 'vitest';
import { askUntil } from '../src/prompts.js';

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
