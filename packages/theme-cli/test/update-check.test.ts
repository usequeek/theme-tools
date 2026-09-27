import { describe, expect, it } from 'vitest';
import { applyUpdateCheckEnv } from '../src/lib/update-check.js';

describe('applyUpdateCheckEnv', () => {
  it('sets the skip flag in CI', () => {
    for (const CI of ['true', '1', 'yes', 'github-actions']) {
      const env = { CI } as NodeJS.ProcessEnv;
      applyUpdateCheckEnv(env);
      expect(env.QUEEK_THEME_SKIP_NEW_VERSION_CHECK, CI).toBe('true');
    }
  });

  it('leaves it alone when CI is unset, empty, false or 0', () => {
    for (const CI of [undefined, '', 'false', '0']) {
      const env = (CI === undefined ? {} : { CI }) as NodeJS.ProcessEnv;
      applyUpdateCheckEnv(env);
      expect(env.QUEEK_THEME_SKIP_NEW_VERSION_CHECK, String(CI)).toBeUndefined();
    }
  });

  it('sets it when QUEEK_THEME_NO_UPDATE_CHECK is set', () => {
    const env = { QUEEK_THEME_NO_UPDATE_CHECK: '1' } as NodeJS.ProcessEnv;
    applyUpdateCheckEnv(env);
    expect(env.QUEEK_THEME_SKIP_NEW_VERSION_CHECK).toBe('true');
  });

  it('leaves it alone when QUEEK_THEME_NO_UPDATE_CHECK is false-ish', () => {
    for (const value of ['', 'false', '0']) {
      const env = { QUEEK_THEME_NO_UPDATE_CHECK: value } as NodeJS.ProcessEnv;
      applyUpdateCheckEnv(env);
      expect(env.QUEEK_THEME_SKIP_NEW_VERSION_CHECK, value).toBeUndefined();
    }
  });
});
