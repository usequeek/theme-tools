import { describe, expect, it } from 'vitest';
import { startersCliRange } from '../../../scripts/starter-cli-range.mjs';

/**
 * The range logic `check-starter-tag.mjs` gates releases on, without the
 * network: the starter's CLI dependency is `@usequeek/cli`, read from
 * devDependencies first, then dependencies.
 */
describe('startersCliRange', () => {
  it('reads devDependencies first', () => {
    expect(
      startersCliRange({
        devDependencies: { '@usequeek/cli': '^0.6.0' },
        dependencies: { '@usequeek/cli': '^0.5.0' },
      }),
    ).toBe('^0.6.0');
  });

  it('falls back to dependencies', () => {
    expect(startersCliRange({ dependencies: { '@usequeek/cli': '^0.6.0' } })).toBe('^0.6.0');
  });

  it('is undefined when the starter declares no CLI dependency', () => {
    expect(startersCliRange({ devDependencies: {}, dependencies: {} })).toBeUndefined();
    expect(startersCliRange({})).toBeUndefined();
  });

  it('ignores unrelated dependencies', () => {
    expect(
      startersCliRange({
        devDependencies: { '@usequeek/theme-check': '^0.6.0' },
      }),
    ).toBeUndefined();
  });
});
