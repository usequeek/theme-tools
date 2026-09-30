import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasCloudflared, matchTunnelRateLimited, startCloudflared } from '../src/lib/app-tunnel.js';

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

describe('matchTunnelRateLimited (the one matcher for refused creation)', () => {
  it('matches 1015, bare 429 and Too Many Attempts in errors and log tails alike', () => {
    expect(matchTunnelRateLimited('ERROR 1015: temporarily banned')).toBe(true);
    expect(matchTunnelRateLimited('failed to create quick tunnel: HTTP 429')).toBe(true);
    expect(matchTunnelRateLimited('2026-09-30 ERR edge error 429 Too Many Attempts')).toBe(true);
    expect(matchTunnelRateLimited('You are being rate limited, please wait 60s')).toBe(true);
    // The refusal the start throws carries the same wording the matcher checks.
    expect(matchTunnelRateLimited('cloudflared refused a new tunnel (rate limited — see cloudflared.log).')).toBe(true);
    expect(matchTunnelRateLimited('cloudflared exited before printing a tunnel URL (see cloudflared.log).')).toBe(false);
    expect(matchTunnelRateLimited('Your quick Tunnel has been created! Visit it at: https://abc.trycloudflare.com')).toBe(false);
  });
});
