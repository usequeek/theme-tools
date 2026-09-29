import { chmodSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeveloperApi } from '../src/lib/app-api.js';
import {
  ensureDevSecrets,
  envLocalPath,
  MISSING_SECRET_MESSAGE,
  MissingSecretError,
  parseDotEnv,
  readEnvFile,
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
