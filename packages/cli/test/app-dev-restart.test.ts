import { describe, expect, it, vi } from 'vitest';
import {
  buildDevAppEnv,
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

/** The supervised app child: one shared call log across stop/start/wait. */
function appCalls(calls: string[], healthy = true): {
  stopApp: () => void;
  startApp: (tunnelUrl: string) => Promise<{ stop: () => void }>;
  waitForApp: () => Promise<boolean>;
} {
  return {
    stopApp: () => {
      calls.push('stopOldApp');
    },
    startApp: async (tunnelUrl: string) => {
      calls.push(`startApp:${tunnelUrl}`);
      return {
        stop: () => {
          calls.push('stopNewApp');
        },
      };
    },
    waitForApp: async () => {
      calls.push('waitForApp');
      return healthy;
    },
  };
}

describe('restartDevTunnel (a dead cloudflared tunnel restarts itself)', () => {
  it('exit → restart → relaunch the app with the new URL → re-register, printing one line', async () => {
    const old = fakeTunnel(OLD_URL);
    const next = fakeTunnel(NEW_URL);
    const calls: string[] = [];
    const lines: string[] = [];
    const errors: string[] = [];
    const app = appCalls(calls);

    const result = await restartDevTunnel({
      oldTunnel: old.tunnel,
      start: async () => {
        calls.push('start');
        return next.tunnel;
      },
      stopApp: app.stopApp,
      startApp: app.startApp,
      waitForApp: app.waitForApp,
      reregister: async (url) => {
        calls.push(`reregister:${url}`);
        return { preview: PREVIEW };
      },
      log: (line) => lines.push(line),
      logError: (line) => errors.push(line),
      sleep: async () => {},
    });

    expect(result.tunnel.url).toBe(NEW_URL);
    // The app relaunches with the NEW url and answers /health before the
    // re-register runs against it, like the toml-save path.
    expect(calls).toEqual(['start', 'stopOldApp', `startApp:${NEW_URL}`, 'waitForApp', `reregister:${NEW_URL}`]);
    // The dead tunnel stops (no orphan), the new one stays up.
    expect(old.stopped).toEqual([true]);
    expect(next.stopped).toEqual([]);
    // Exactly one clear line, naming the new tunnel and the new Preview URL.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(NEW_URL);
    expect(lines[0]).toContain(PREVIEW);
    expect(errors).toEqual([]);
    // The returned stopper kills the relaunched child.
    result.stopApp();
    expect(calls.at(-1)).toBe('stopNewApp');
  });

  it('backs off between failed starts and stops after a sane number of failures', async () => {
    const old = fakeTunnel(OLD_URL);
    const waits: number[] = [];
    const reregister = vi.fn(async (_url: string) => ({ preview: PREVIEW }));
    const startApp = vi.fn(async (_url: string) => ({ stop: () => {} }));
    let starts = 0;

    const error = await restartDevTunnel({
      oldTunnel: old.tunnel,
      start: async () => {
        starts += 1;
        throw new Error('network is down');
      },
      stopApp: () => {},
      startApp,
      waitForApp: async () => true,
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
    expect(startApp).not.toHaveBeenCalled();
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
    const calls: string[] = [];
    const app = appCalls(calls);
    let starts = 0;

    const result = await restartDevTunnel({
      oldTunnel: old.tunnel,
      start: async () => {
        starts += 1;
        if (starts === 1) throw new Error('blip');
        return next.tunnel;
      },
      stopApp: app.stopApp,
      startApp: app.startApp,
      waitForApp: app.waitForApp,
      reregister: async (url) => {
        seen.push(url);
        calls.push(`reregister:${url}`);
        return { preview: null };
      },
      log: () => {},
      logError: () => {},
      sleep: async () => {},
    });

    expect(result.tunnel.url).toBe(NEW_URL);
    expect(seen).toEqual([NEW_URL]);
    expect(calls).toEqual(['stopOldApp', `startApp:${NEW_URL}`, 'waitForApp', `reregister:${NEW_URL}`]);
    expect(old.stopped).toEqual([true]);
  });

  it('a failed re-register keeps the new tunnel and logs instead of giving up', async () => {
    const old = fakeTunnel(OLD_URL);
    const next = fakeTunnel(NEW_URL);
    const calls: string[] = [];
    const app = appCalls(calls);
    const lines: string[] = [];
    const errors: string[] = [];

    const result = await restartDevTunnel({
      oldTunnel: old.tunnel,
      start: async () => next.tunnel,
      stopApp: app.stopApp,
      startApp: app.startApp,
      waitForApp: app.waitForApp,
      reregister: async () => {
        throw new Error('deploy refused');
      },
      log: (line) => lines.push(line),
      logError: (line) => errors.push(line),
      sleep: async () => {},
    });

    expect(result.tunnel.url).toBe(NEW_URL);
    expect(next.stopped).toEqual([]);
    expect(errors).toEqual(['Re-register after tunnel restart failed: deploy refused']);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(NEW_URL);
  });

  it('an app that never answers /health stops its child and tunnel and fails the run', async () => {
    const old = fakeTunnel(OLD_URL);
    const next = fakeTunnel(NEW_URL);
    const calls: string[] = [];
    const app = appCalls(calls, false);
    const reregister = vi.fn(async (_url: string) => ({ preview: PREVIEW }));

    const error = await restartDevTunnel({
      oldTunnel: old.tunnel,
      start: async () => next.tunnel,
      stopApp: app.stopApp,
      startApp: app.startApp,
      waitForApp: app.waitForApp,
      reregister,
      log: () => {},
      logError: () => {},
      sleep: async () => {},
    }).then(
      () => null,
      (caught: Error) => caught,
    );

    expect(error?.message).toContain('did not answer /health after the tunnel restart');
    // Nothing installs against an app that is not listening; nothing lingers.
    expect(reregister).not.toHaveBeenCalled();
    expect(calls).toEqual(['stopOldApp', `startApp:${NEW_URL}`, 'waitForApp', 'stopNewApp']);
    expect(next.stopped).toEqual([true]);
    expect(old.stopped).toEqual([true]);
  });

  it('a failed app relaunch stops the new tunnel and fails with the cause', async () => {
    const old = fakeTunnel(OLD_URL);
    const next = fakeTunnel(NEW_URL);
    const reregister = vi.fn(async (_url: string) => ({ preview: PREVIEW }));

    const error = await restartDevTunnel({
      oldTunnel: old.tunnel,
      start: async () => next.tunnel,
      stopApp: () => {},
      startApp: async () => {
        throw new Error('keys failed');
      },
      waitForApp: async () => true,
      reregister,
      log: () => {},
      logError: () => {},
      sleep: async () => {},
    }).then(
      () => null,
      (caught: Error) => caught,
    );

    expect(error?.message).toContain('Relaunching the app on the new tunnel failed');
    expect(error?.message).toContain('keys failed');
    expect(next.stopped).toEqual([true]);
    expect(reregister).not.toHaveBeenCalled();
  });
});

describe('buildDevAppEnv (the relaunched app tracks the new tunnel)', () => {
  it('points APP_BASE_URL at the new tunnel origin, CLI-owned keys winning', () => {
    const env = buildDevAppEnv({
      appDir: '/app',
      tunnelUrl: NEW_URL,
      port: 3000,
      apiBase: 'https://api.example.com',
      secrets: { QUEEK_APP_SECRET: 'secret' },
      projectEnv: { APP_BASE_URL: OLD_URL, PORT: '9999' },
    });
    expect(env.APP_BASE_URL).toBe(new URL(NEW_URL).origin);
    expect(env.PORT).toBe('3000');
    expect(env.NODE_ENV).toBe('development');
    expect(env.QUEEK_API_BASE).toBe('https://api.example.com');
    expect(env.QUEEK_APP_SECRET).toBe('secret');
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
