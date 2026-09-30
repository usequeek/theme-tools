import { describe, expect, it, vi } from 'vitest';
import {
  countTunnelMiss,
  MAX_TUNNEL_RESTARTS,
  restartDevTunnel,
  TUNNEL_FAILURES_BEFORE_RESTART,
  tunnelProbe,
  tunnelRestartBackoffMs,
  tunnelRestartLine,
} from '../src/commands/app/dev.js';
import type { Tunnel } from '../src/lib/app-tunnel.js';

const OLD_URL = 'https://old-dead.trycloudflare.com';
const NEW_URL = 'https://new-live.trycloudflare.com';
const PREVIEW = 'https://dashboard.usequeek.com/open-store?store=12&app=hello';

function fakeTunnel(url: string): { tunnel: Tunnel; stopped: boolean[] } {
  const stopped: boolean[] = [];
  const exits: Array<() => void> = [];
  const tunnel: Tunnel = {
    url,
    how: 'cloudflared',
    stop: () => {
      stopped.push(true);
    },
    onExit: (listener: () => void) => {
      exits.push(listener);
    },
  };
  return { tunnel, stopped };
}

describe('restartDevTunnel (a dead cloudflared tunnel restarts itself)', () => {
  it('exit → restart → re-register with the new URL, printing one line', async () => {
    const old = fakeTunnel(OLD_URL);
    const next = fakeTunnel(NEW_URL);
    const calls: string[] = [];
    const lines: string[] = [];
    const errors: string[] = [];

    const result = await restartDevTunnel({
      oldTunnel: old.tunnel,
      start: async () => {
        calls.push('start');
        return next.tunnel;
      },
      reregister: async (url) => {
        calls.push(`reregister:${url}`);
        return { preview: PREVIEW };
      },
      log: (line) => lines.push(line),
      logError: (line) => errors.push(line),
      sleep: async () => {},
    });

    expect(result.url).toBe(NEW_URL);
    // The re-register ran against the NEW url, like the toml-save path.
    expect(calls).toEqual(['start', `reregister:${NEW_URL}`]);
    // The dead tunnel stops (no orphan), the new one stays up.
    expect(old.stopped).toEqual([true]);
    expect(next.stopped).toEqual([]);
    // Exactly one clear line, naming the new tunnel and the new Preview URL.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(NEW_URL);
    expect(lines[0]).toContain(PREVIEW);
    expect(errors).toEqual([]);
  });

  it('backs off between failed starts and stops after a sane number of failures', async () => {
    const old = fakeTunnel(OLD_URL);
    const waits: number[] = [];
    const reregister = vi.fn(async (_url: string) => ({ preview: PREVIEW }));
    let starts = 0;

    const error = await restartDevTunnel({
      oldTunnel: old.tunnel,
      start: async () => {
        starts += 1;
        throw new Error('network is down');
      },
      reregister,
      log: () => {},
      logError: () => {},
      sleep: async (ms) => {
        waits.push(ms);
      },
      maxRestarts: 3,
      backoffMs: (attempt) => attempt * 1000,
    }).then(
      () => null,
      (caught: Error) => caught,
    );

    expect(starts).toBe(3);
    expect(waits).toEqual([1000, 2000]);
    expect(reregister).not.toHaveBeenCalled();
    expect(old.stopped).toEqual([true]);
    expect(error?.message).toContain('Tunnel restart failed 3 times');
    expect(error?.message).toContain('network is down');
    expect(error?.message).toContain('queek app dev');
  });

  it('retries after a failure and succeeds on the next start', async () => {
    const old = fakeTunnel(OLD_URL);
    const next = fakeTunnel(NEW_URL);
    const seen: string[] = [];
    let starts = 0;

    const result = await restartDevTunnel({
      oldTunnel: old.tunnel,
      start: async () => {
        starts += 1;
        if (starts === 1) throw new Error('blip');
        return next.tunnel;
      },
      reregister: async (url) => {
        seen.push(url);
        return { preview: null };
      },
      log: () => {},
      logError: () => {},
      sleep: async () => {},
    });

    expect(result.url).toBe(NEW_URL);
    expect(seen).toEqual([NEW_URL]);
    expect(old.stopped).toEqual([true]);
  });

  it('a failed re-register keeps the new tunnel and logs instead of giving up', async () => {
    const old = fakeTunnel(OLD_URL);
    const next = fakeTunnel(NEW_URL);
    const lines: string[] = [];
    const errors: string[] = [];

    const result = await restartDevTunnel({
      oldTunnel: old.tunnel,
      start: async () => next.tunnel,
      reregister: async () => {
        throw new Error('deploy refused');
      },
      log: (line) => lines.push(line),
      logError: (line) => errors.push(line),
      sleep: async () => {},
    });

    expect(result.url).toBe(NEW_URL);
    expect(next.stopped).toEqual([]);
    expect(errors).toEqual(['Re-register after tunnel restart failed: deploy refused']);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(NEW_URL);
  });
});

describe('tunnel restart constants and lines', () => {
  it('backs off 5s → 10s → 20s, capped at 30s', () => {
    expect(tunnelRestartBackoffMs(1)).toBe(5_000);
    expect(tunnelRestartBackoffMs(2)).toBe(10_000);
    expect(tunnelRestartBackoffMs(3)).toBe(20_000);
    expect(tunnelRestartBackoffMs(4)).toBe(30_000);
    expect(tunnelRestartBackoffMs(9)).toBe(30_000);
    expect(MAX_TUNNEL_RESTARTS).toBeGreaterThanOrEqual(3);
  });

  it('names old → new tunnel and the Preview URL, falling back to the tunnel URL', () => {
    const line = tunnelRestartLine(OLD_URL, NEW_URL, PREVIEW);
    expect(line).toContain(OLD_URL);
    expect(line).toContain(NEW_URL);
    expect(line).toContain(PREVIEW);
    expect(tunnelRestartLine(OLD_URL, NEW_URL, null)).toContain(NEW_URL);
  });
});

describe('tunnelProbe (the /health check)', () => {
  it('probes <url>/health: ok reads healthy', async () => {
    const seen: string[] = [];
    const healthy = await tunnelProbe(NEW_URL, async (url) => {
      seen.push(url);
      return { ok: true };
    });
    expect(healthy).toBe(true);
    expect(seen).toEqual([`${NEW_URL}/health`]);
  });

  it('non-2xx and refused connections read as down', async () => {
    await expect(tunnelProbe(NEW_URL, async () => ({ ok: false }))).resolves.toBe(false);
    await expect(
      tunnelProbe(NEW_URL, async () => {
        throw new Error('ENOTFOUND');
      }),
    ).resolves.toBe(false);
  });
});

describe('countTunnelMiss (restart on N misses in a row)', () => {
  it('a success resets the count; N misses restart once', () => {
    expect(countTunnelMiss(true, 4)).toEqual({ misses: 0, restart: false });
    let state = { misses: 0, restart: false };
    for (let attempt = 1; attempt <= TUNNEL_FAILURES_BEFORE_RESTART; attempt++) {
      state = countTunnelMiss(false, state.misses);
    }
    expect(state).toEqual({ misses: 0, restart: true });
  });

  it('a single miss below the threshold only counts', () => {
    expect(countTunnelMiss(false, 0)).toEqual({ misses: 1, restart: false });
  });
});
