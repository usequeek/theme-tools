import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloudflaredRateLimited, hasCloudflared, startCloudflared } from '../src/lib/app-tunnel.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('tunnel without the binary (spawn never throws sync)', () => {
  it('fails fast with the one-line install message instead of crashing on the async error event', async () => {
    vi.stubEnv('PATH', '/nonexistent-dir-for-tests');
    expect(hasCloudflared()).toBe(false);
    const error = await startCloudflared(1, '/tmp/queek-no-tunnel-test.log').catch((e: unknown) => e);
    expect((error as Error).message).toContain('No cloudflared on PATH');
    expect((error as Error).message).toContain('brew install cloudflared');
    expect((error as Error).message).toContain('winget install --id Cloudflare.cloudflared');
    expect((error as Error).message).toContain('--url');
  });
});

describe('cloudflaredRateLimited (refused creation stops supervision)', () => {
  it('matches error 1015 / HTTP 429 in the log, nothing else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'queek-tunnel-log-'));
    const banned = join(dir, 'banned.log');
    const healthy = join(dir, 'healthy.log');
    writeFileSync(banned, '2026-09-30 ERR failed to create quick tunnel: error 1015, HTTP 429\n');
    writeFileSync(healthy, '2026-09-30 INF +--------------------------------------------------+\n2026-09-30 INF |  Your quick Tunnel has been created! Visit it at: |\n');
    expect(cloudflaredRateLimited(banned)).toBe(true);
    expect(cloudflaredRateLimited(healthy)).toBe(false);
    expect(cloudflaredRateLimited(join(dir, 'missing.log'))).toBe(false);
  });
});
