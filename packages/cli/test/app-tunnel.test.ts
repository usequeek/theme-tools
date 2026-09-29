import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasCloudflared, startCloudflared } from '../src/lib/app-tunnel.js';

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
