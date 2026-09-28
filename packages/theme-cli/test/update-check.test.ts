import { describe, expect, it } from 'vitest';
import { applyUpdateCheckEnv } from '../src/lib/update-check.js';

describe('applyUpdateCheckEnv', () => {
  it('sets the skip flag for both bins in CI', () => {
    for (const CI of ['true', '1', 'yes', 'github-actions']) {
      const env = { CI } as NodeJS.ProcessEnv;
      applyUpdateCheckEnv(env);
      expect(env.QUEEK_THEME_SKIP_NEW_VERSION_CHECK, CI).toBe('true');
      expect(env.QUEEK_SKIP_NEW_VERSION_CHECK, CI).toBe('true');
    }
  });

  it('leaves both alone when CI is unset, empty, false or 0', () => {
    for (const CI of [undefined, '', 'false', '0']) {
      const env = (CI === undefined ? {} : { CI }) as NodeJS.ProcessEnv;
      applyUpdateCheckEnv(env);
      expect(env.QUEEK_THEME_SKIP_NEW_VERSION_CHECK, String(CI)).toBeUndefined();
      expect(env.QUEEK_SKIP_NEW_VERSION_CHECK, String(CI)).toBeUndefined();
    }
  });

  it('sets both when QUEEK_THEME_NO_UPDATE_CHECK is set', () => {
    const env = { QUEEK_THEME_NO_UPDATE_CHECK: '1' } as NodeJS.ProcessEnv;
    applyUpdateCheckEnv(env);
    expect(env.QUEEK_THEME_SKIP_NEW_VERSION_CHECK).toBe('true');
    expect(env.QUEEK_SKIP_NEW_VERSION_CHECK).toBe('true');
  });

  it('sets both when QUEEK_NO_UPDATE_CHECK is set', () => {
    const env = { QUEEK_NO_UPDATE_CHECK: '1' } as NodeJS.ProcessEnv;
    applyUpdateCheckEnv(env);
    expect(env.QUEEK_THEME_SKIP_NEW_VERSION_CHECK).toBe('true');
    expect(env.QUEEK_SKIP_NEW_VERSION_CHECK).toBe('true');
  });

  it('leaves both alone when the no-update-check flags are false-ish', () => {
    for (const value of ['', 'false', '0']) {
      for (const name of ['QUEEK_THEME_NO_UPDATE_CHECK', 'QUEEK_NO_UPDATE_CHECK'] as const) {
        const env = { [name]: value } as NodeJS.ProcessEnv;
        applyUpdateCheckEnv(env);
        expect(env.QUEEK_THEME_SKIP_NEW_VERSION_CHECK, `${name}=${value}`).toBeUndefined();
        expect(env.QUEEK_SKIP_NEW_VERSION_CHECK, `${name}=${value}`).toBeUndefined();
      }
    }
  });
});
