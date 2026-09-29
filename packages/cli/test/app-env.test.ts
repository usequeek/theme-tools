import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, AutomationTokenError, type DeveloperApi } from '../src/lib/app-api.js';
import {
  ensureDevSecrets,
  envLocalPath,
  MISSING_SECRET_MESSAGE,
  MissingSecretError,
  parseDotEnv,
  readEnvFile,
  resolveDevSecret,
  toOneLineBase64,
  writeEnvLocal,
} from '../src/lib/app-env.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function stage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'app-env-'));
  dirs.push(dir);
  return dir;
}

describe('parseDotEnv (documented subset, values raw)', () => {
  it('reads KEY=value, export, quotes and comments; skips the rest', () => {
    expect(
      parseDotEnv(
        '# comment\nPORT=3000\nexport APP_BASE_URL=https://x.example.com\nQUOTED="a b"\nSINGLE=\'c d\'\nTRAILING=1 # note\nno-equals here\n',
      ),
    ).toEqual({
      PORT: '3000',
      APP_BASE_URL: 'https://x.example.com',
      QUOTED: 'a b',
      SINGLE: 'c d',
      TRAILING: '1',
    });
  });

  it('reads nothing when the file is absent', () => {
    expect(readEnvFile(join(stage(), 'nope'))).toEqual({});
  });
});

describe('writeEnvLocal (merge, 0600, path is the receipt)', () => {
  it('merges into .queek/.env.local without touching unnamed keys', () => {
    const queek = join(stage(), '.queek');
    const first = writeEnvLocal(queek, { QUEEK_APP_SECRET: 'whsec_1', APP_KEY_ID: 'k1' });
    const second = writeEnvLocal(queek, { APP_KEY_ID: 'k2' });
    expect(first).toBe(second);
    expect(second).toBe(envLocalPath(queek));
    expect(readEnvFile(second)).toEqual({ QUEEK_APP_SECRET: 'whsec_1', APP_KEY_ID: 'k2' });
  });

  // Windows has no POSIX permission bits — Node's chmod only toggles read-only.
  describe.runIf(process.platform !== 'win32')('file mode', () => {
    it('writes the file 0600', () => {
      const file = writeEnvLocal(join(stage(), '.queek'), { A: '1' });
      expect(statSync(file).mode & 0o777).toBe(0o600);
    });

    it('repairs the mode when the file already exists', () => {
      const queek = join(stage(), '.queek');
      const file = writeEnvLocal(queek, { A: '1' });
      chmodSync(file, 0o644);
      writeEnvLocal(queek, { B: '2' });
      expect(statSync(file).mode & 0o777).toBe(0o600);
    });
  });
});

describe('toOneLineBase64 (PEM → one line for APP_PRIVATE_KEY)', () => {
  it('round-trips through base64', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n';
    expect(toOneLineBase64(pem)).not.toContain('\n');
    expect(Buffer.from(toOneLineBase64(pem), 'base64').toString('utf8')).toBe(pem);
  });
});

const apiWith = (overrides: Partial<DeveloperApi> = {}): DeveloperApi =>
  ({
    generateAppKey: vi.fn(async () => ({ kid: 'kid_1', privateKey: 'PEM_BYTES' })),
    ...overrides,
  }) as unknown as DeveloperApi;

describe('ensureDevSecrets (local first, minted otherwise, never printed, never rotated)', () => {
  it('uses recorded values and calls nothing when all three are present', async () => {
    const api = apiWith();
    const lines: string[] = [];
    const { values, generated } = await ensureDevSecrets(
      api,
      'hello',
      { QUEEK_APP_SECRET: 'whsec_old', APP_KEY_ID: 'k0', APP_PRIVATE_KEY: 'UEVN', APP_ENCRYPTION_KEY: 'ZW5j' },
      [],
      (line) => lines.push(line),
    );
    expect(values).toEqual({ QUEEK_APP_SECRET: 'whsec_old', APP_KEY_ID: 'k0', APP_PRIVATE_KEY: 'UEVN', APP_ENCRYPTION_KEY: 'ZW5j' });
    expect(generated).toEqual([]);
    expect(api.generateAppKey).not.toHaveBeenCalled();
  });

  it('takes the secret from the environment without persisting it, and still mints the rest', async () => {
    const api = apiWith();
    const { values, generated } = await ensureDevSecrets(api, 'hello', {}, [], () => {}, 'whsec_env');
    expect(values.QUEEK_APP_SECRET).toBe('whsec_env');
    expect(values.APP_KEY_ID).toBe('kid_1');
    expect(generated).toEqual(['APP_KEY_ID', 'APP_PRIVATE_KEY', 'APP_ENCRYPTION_KEY']);
  });

  it('stops with the recovery message when the secret is nowhere (exit 2, never a rotation)', async () => {
    const api = apiWith();
    const error = await ensureDevSecrets(api, 'hello', {}, [], () => {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MissingSecretError);
    expect((error as Error).message).toBe(MISSING_SECRET_MESSAGE);
    expect((error as Error).message).toContain('queek app dev -c development');
    expect(api.generateAppKey).not.toHaveBeenCalled();
  });

  it('generates the keypair once and rolls local random bytes when those are missing', async () => {
    const api = apiWith();
    const { values, generated } = await ensureDevSecrets(api, 'hello', { QUEEK_APP_SECRET: 'whsec_old' }, ['kid_0'], () => {});
    expect(values.APP_KEY_ID).toBe('kid_1');
    expect(values.APP_PRIVATE_KEY).toBe(toOneLineBase64('PEM_BYTES'));
    expect(Buffer.from(values.APP_PRIVATE_KEY, 'base64').toString('utf8')).toBe('PEM_BYTES');
    expect(Buffer.from(values.APP_ENCRYPTION_KEY, 'base64')).toHaveLength(32);
    expect(generated).toEqual(['APP_KEY_ID', 'APP_PRIVATE_KEY', 'APP_ENCRYPTION_KEY']);
    expect(api.generateAppKey).toHaveBeenCalledWith('hello');
  });

  it('regenerates the whole pair when only the kid survived (a kid without its key is useless)', async () => {
    const api = apiWith();
    const { values, generated } = await ensureDevSecrets(
      api,
      'hello',
      { QUEEK_APP_SECRET: 's', APP_KEY_ID: 'orphan', APP_ENCRYPTION_KEY: 'e' },
      ['orphan'],
      () => {},
    );
    expect(values.APP_KEY_ID).toBe('kid_1');
    expect(generated).toEqual(['APP_KEY_ID', 'APP_PRIVATE_KEY']);
  });

  it('stops with a clear message on a full keyring instead of failing mid-flow', async () => {
    const api = apiWith();
    const error = await ensureDevSecrets(api, 'hello', { QUEEK_APP_SECRET: 's' }, ['k1', 'k2', 'k3'], () => {}).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(MissingSecretError);
    expect((error as Error).message).toContain('already has 3 keys');
    expect(api.generateAppKey).not.toHaveBeenCalled();
  });
});

describe('resolveDevSecret (local, env, then the owner re-view — never a rotation)', () => {
  const secretApi = (secret = 'whsec_fetched') =>
    apiWith({ appSigningSecret: vi.fn(async () => ({ secret, previousExpiresAt: null })) });

  it('fetches a missing secret over the session and merges it into .env.local', async () => {
    const api = secretApi();
    const queek = join(stage(), '.queek');
    writeEnvLocal(queek, { APP_KEY_ID: 'k1' });
    const lines: string[] = [];
    await resolveDevSecret(api, 'hello', queek, readEnvFile(envLocalPath(queek)), undefined, (line) => lines.push(line));
    expect(api.appSigningSecret).toHaveBeenCalledWith('hello');
    expect(readEnvFile(envLocalPath(queek))).toEqual({ APP_KEY_ID: 'k1', QUEEK_APP_SECRET: 'whsec_fetched' });
    expect(lines.join('\n')).not.toContain('whsec_fetched');
    expect(lines.join('\n')).toContain(envLocalPath(queek));
  });

  it('skips the fetch when the file or the environment already holds the secret', async () => {
    const api = secretApi();
    const queek = join(stage(), '.queek');
    const lines: string[] = [];
    await resolveDevSecret(api, 'hello', queek, { QUEEK_APP_SECRET: 'whsec_old' }, undefined, (line) => lines.push(line));
    await resolveDevSecret(api, 'hello', queek, {}, 'whsec_env', (line) => lines.push(line));
    expect(api.appSigningSecret).not.toHaveBeenCalled();
    expect(lines).toEqual([]);
  });

  it('falls back to the dashboard-Reveal message when the fetch fails', async () => {
    const api = apiWith({ appSigningSecret: vi.fn(async () => { throw new ApiError('App not found.', 404, null); }) });
    const queek = join(stage(), '.queek');
    const error = await resolveDevSecret(api, 'hello', queek, {}, undefined, () => {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MissingSecretError);
    expect((error as Error).message).toBe(MISSING_SECRET_MESSAGE);
    expect((error as Error).message).toContain('Developers → your app → Credentials → Reveal');
    expect(readEnvFile(envLocalPath(queek))).toEqual({});
  });

  it('keeps the automation refusal untouched (dev refuses those tokens first)', async () => {
    const refusal = new AutomationTokenError("This automation token can't do that — it only works for its own app. (Server: Unauthenticated.)", 401, null);
    const api = apiWith({ appSigningSecret: vi.fn(async () => { throw refusal; }) });
    const error = await resolveDevSecret(api, 'hello', join(stage(), '.queek'), {}, undefined, () => {}).catch((e: unknown) => e);
    expect(error).toBe(refusal);
    expect(error).not.toBeInstanceOf(MissingSecretError);
  });

  it('never rotates: no rotate call exists on the fetch path', async () => {
    const api = secretApi();
    await resolveDevSecret(api, 'hello', join(stage(), '.queek'), {}, undefined, () => {});
    expect((api as unknown as Record<string, unknown>).rotateSecret).toBeUndefined();
    expect(api.appSigningSecret).toHaveBeenCalledTimes(1);
  });

  describe.runIf(process.platform !== 'win32')('file mode', () => {
    it('writes the fetched secret 0600', async () => {
      const queek = join(stage(), '.queek');
      await resolveDevSecret(secretApi(), 'hello', queek, {}, undefined, () => {});
      expect(statSync(envLocalPath(queek)).mode & 0o777).toBe(0o600);
    });
  });
});
