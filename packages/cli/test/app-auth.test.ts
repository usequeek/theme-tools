import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearToken, configDir, readToken, writeToken } from '../src/lib/app-auth.js';

const originals = { ...process.env };

afterEach(() => {
  process.env = { ...originals };
  vi.unstubAllGlobals();
});

describe('token store', () => {
  it('prefers QUEEK_CLI_TOKEN over everything (CI/SSH)', async () => {
    process.env.QUEEK_CLI_TOKEN = 'env-tok';
    expect(await readToken()).toEqual({ token: 'env-tok', source: 'env' });
  });

  it('round-trips a file token under XDG_CONFIG_HOME with 0600 scope', async () => {
    const home = mkdtempSync(join(tmpdir(), 'queek-home-'));
    process.env.XDG_CONFIG_HOME = home;
    delete process.env.QUEEK_CLI_TOKEN;
    expect(configDir()).toBe(join(home, 'queek'));
    // No keytar in this environment, so the file backend owns the token.
    expect(await writeToken('file-tok')).toBe('file');
    expect(await readToken()).toEqual({ token: 'file-tok', source: 'file' });
    const { cleared, envSet } = await clearToken();
    expect(cleared).toContain('file');
    expect(envSet).toBe(false);
    expect(await readToken()).toBeNull();
  });

  it('reports the env override on logout so it is not silently kept', async () => {
    process.env.QUEEK_CLI_TOKEN = 'env-tok';
    const { envSet } = await clearToken();
    expect(envSet).toBe(true);
    // The env token still authenticates until unset.
    expect(await readToken()).toEqual({ token: 'env-tok', source: 'env' });
  });
});
