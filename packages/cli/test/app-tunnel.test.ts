import { afterEach, describe, expect, it, vi } from 'vitest';
import { hasCloudflared, matchTunnelRateLimited, startCloudflared, tunnelNotReadyMessage, waitForTunnel } from '../src/lib/app-tunnel.js';

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

describe('waitForTunnel (resolution + GET, visible, bounded)', () => {
  const clock = () => {
    let at = 0;
    return { now: () => at, sleep: async (ms: number) => { at += ms; } };
  };
  const URL_ = 'https://abc-def.trycloudflare.com';

  it('is ready at once when the name resolves and /health answers 2xx, printing nothing', async () => {
    const lines: string[] = [];
    const get = vi.fn(async () => ({ ok: true, status: 200 }));
    const result = await waitForTunnel(URL_, { ...clock(), resolveHost: async () => ({}), get, onWait: (line) => lines.push(line) });
    expect(result).toEqual({ ready: true });
    expect(get).toHaveBeenCalledWith('https://abc-def.trycloudflare.com/health');
    expect(lines).toEqual([]);
  });

  it('does not GET until the hostname resolves, and shows "Waiting for the tunnel (n/30s)…" every 5s', async () => {
    const lines: string[] = [];
    let resolves = 0;
    const get = vi.fn(async () => ({ ok: true, status: 200 }));
    const result = await waitForTunnel(URL_, {
      ...clock(),
      resolveHost: async () => {
        resolves += 1;
        if (resolves <= 12) throw new Error('ENOTFOUND');
        return {};
      },
      get,
      onWait: (line) => lines.push(line),
    });
    expect(result).toEqual({ ready: true });
    expect(resolves).toBe(13);
    expect(get).toHaveBeenCalledTimes(1);
    expect(lines).toEqual(['Waiting for the tunnel (0/30s)…', 'Waiting for the tunnel (5/30s)…', 'Waiting for the tunnel (10/30s)…']);
  });

  it('keeps waiting while /health is not 2xx, then succeeds', async () => {
    const answers = [502, 502, 200];
    const result = await waitForTunnel(URL_, {
      ...clock(),
      resolveHost: async () => ({}),
      get: async () => {
        const status = answers.shift() as number;
        return { ok: status === 200, status };
      },
    });
    expect(result).toEqual({ ready: true });
  });

  it('gives up after 30s when the name never resolves, with the DNS reason', async () => {
    const lines: string[] = [];
    const result = await waitForTunnel(URL_, { ...clock(), resolveHost: async () => { throw new Error('ENOTFOUND'); }, get: async () => ({ ok: true, status: 200 }), onWait: (line) => lines.push(line) });
    expect(result).toEqual({ ready: false, detail: 'the hostname abc-def.trycloudflare.com does not resolve yet' });
    expect(lines.at(-1)).toBe('Waiting for the tunnel (25/30s)…');
    expect(lines).toHaveLength(6);
  });

  it('gives up with the HTTP reason when it resolves but never answers 2xx, or the request fails', async () => {
    const status = await waitForTunnel(URL_, { ...clock(), resolveHost: async () => ({}), get: async () => ({ ok: false, status: 530 }) });
    expect(status).toEqual({ ready: false, detail: 'https://abc-def.trycloudflare.com/health answered 530' });
    const refused = await waitForTunnel(URL_, { ...clock(), resolveHost: async () => ({}), get: async () => { throw new Error('connect ECONNREFUSED'); } });
    expect(refused).toMatchObject({ ready: false });
    expect((refused as { detail: string }).detail).toContain('connect ECONNREFUSED');
  });

  it('the failure message says nothing was installed and offers both ways out', () => {
    const message = tunnelNotReadyMessage(URL_, 'the hostname abc-def.trycloudflare.com does not resolve yet');
    expect(message).toContain('within 30s');
    expect(message).toContain('Nothing was installed');
    expect(message).toContain('--url');
    expect(message).toContain('`queek app dev` again');
  });
});
