import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  automationToken,
  clearSession,
  configDir,
  readSession,
  sessionExpired,
  sessionFromPair,
  writeSession,
  type CliSession,
} from '../src/lib/app-auth.js';

const originals = { ...process.env };

afterEach(() => {
  process.env = { ...originals };
});

function isolatedHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'queek-home-'));
  process.env.XDG_CONFIG_HOME = home;
  delete process.env.QUEEK_APP_AUTOMATION_TOKEN;
  return home;
}

const pair = { access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'developer-cli' };

describe('CLI auth storage', () => {
  it('reads the CI automation token and nothing else from env', async () => {
    isolatedHome();
    expect(automationToken()).toBeUndefined();
    process.env.QUEEK_APP_AUTOMATION_TOKEN = 'auto-tok';
    expect(automationToken()).toBe('auto-tok');
    // The personal override is gone (Shopify has none): only the session file counts.
    process.env.QUEEK_CLI_TOKEN = 'legacy';
    expect(await readSession()).toBeNull();
  });

  it('round-trips a session under XDG_CONFIG_HOME with 0600 scope', async () => {
    const home = isolatedHome();
    expect(configDir()).toBe(join(home, 'queek'));
    // No keytar in this environment, so the file backend owns the session.
    expect(await writeSession(sessionFromPair(pair))).toBe('file');
    const found = await readSession();
    expect(found?.source).toBe('file');
    expect(found?.session.access_token).toBe('a');
    const { cleared, automationSet } = await clearSession();
    expect(cleared).toContain('file');
    expect(automationSet).toBe(false);
    expect(await readSession()).toBeNull();
  });

  it('reports the automation token on logout so it is not silently kept', async () => {
    isolatedHome();
    process.env.QUEEK_APP_AUTOMATION_TOKEN = 'auto-tok';
    const { automationSet } = await clearSession();
    expect(automationSet).toBe(true);
    expect(automationToken()).toBe('auto-tok');
  });

  it('expires sessions 60s early and stamps expiry from expires_in', () => {
    const fresh: CliSession = { access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3600_000, scope: '' };
    expect(sessionExpired(fresh)).toBe(false);
    expect(sessionExpired({ ...fresh, expires_at: Date.now() + 59_000 })).toBe(true);
    expect(sessionExpired({ ...fresh, expires_at: Date.now() - 1 })).toBe(true);
    expect(sessionFromPair(pair).expires_at).toBeGreaterThan(Date.now() + 3590_000);
  });
});
