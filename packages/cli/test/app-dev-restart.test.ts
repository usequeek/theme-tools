import { describe, expect, it, vi } from 'vitest';
import {
  buildDevAppEnv,
  countTunnelMiss,
  createDeployQueue,
  DevTunnelSupervisor,
  isTunnelRateLimited,
  MAX_TUNNEL_RESTARTS,
  MAX_TUNNEL_RESTARTS_PER_WINDOW,
  restartDevTunnel,
  TUNNEL_FAILURES_BEFORE_RESTART,
  tunnelProbe,
  tunnelRestartBackoffMs,
  tunnelRestartLine,
  TunnelRateLimitedError,
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

describe('isTunnelRateLimited (refused creation stops supervision)', () => {
  it('matches Cloudflare 429/1015 and Too Many Attempts, nothing else', () => {
    expect(isTunnelRateLimited(new Error('ERROR 1015: temporarily banned'))).toBe(true);
    expect(isTunnelRateLimited(new Error('tunnel creation failed: HTTP 429'))).toBe(true);
    expect(isTunnelRateLimited(new Error('Too Many Attempts.'))).toBe(true);
    expect(isTunnelRateLimited(new Error('You are being rate limited, please wait'))).toBe(true);
    expect(isTunnelRateLimited(new Error('network is down'))).toBe(false);
    expect(isTunnelRateLimited(new Error('cloudflared exited before printing a tunnel URL (see log)'))).toBe(false);
    expect(isTunnelRateLimited(new Error('clean'), '... error 1015 ...')).toBe(true);
  });
});

/** A watched fake tunnel: stop() kills the child, which fires exit — like the real one. */
function fakeWatchedTunnel(calls: string[], url: string): { tunnel: Tunnel; fireExit: () => void } {
  const exits: Array<() => void> = [];
  const fire = (): void => {
    for (const listener of [...exits]) listener();
  };
  const tunnel: Tunnel = {
    url,
    how: 'cloudflared',
    stop: () => {
      calls.push(`stop:${url}`);
      fire();
    },
    onExit: (listener: () => void) => {
      exits.push(listener);
    },
  };
  return { tunnel, fireExit: fire };
}

function supervisorHarness(hooks: {
  probeHealthy?: boolean;
  probe?: (url: string) => Promise<boolean>;
  appHealthy?: boolean;
  startTunnel?: () => Promise<Tunnel>;
  reregister?: (url: string) => Promise<{ preview: string | null }>;
  isFatalStartError?: (error: unknown) => boolean;
} = {}): {
  sup: DevTunnelSupervisor;
  calls: string[];
  tunnels: Tunnel[];
  stopped: string[];
  errors: Error[];
  advance: (ms: number) => void;
} {
  let now = 0;
  const calls: string[] = [];
  const tunnels: Tunnel[] = [];
  const stopped: string[] = [];
  const errors: Error[] = [];
  let n = 0;
  const sup = new DevTunnelSupervisor({
    startTunnel: hooks.startTunnel ??
      (async () => {
        n += 1;
        const url = `https://t${n}.trycloudflare.com`;
        calls.push(`start:${url}`);
        const created = fakeWatchedTunnel(calls, url);
        tunnels.push(created.tunnel);
        return created.tunnel;
      }),
    stopApp: () => {
      calls.push('stopOldApp');
    },
    startApp: async (url) => {
      calls.push(`startApp:${url}`);
      return {
        stop: () => {
          calls.push('stopNewApp');
        },
      };
    },
    waitForApp: async () => hooks.appHealthy ?? true,
    reregister: hooks.reregister ??
      (async (url) => {
        calls.push(`reregister:${url}`);
        return { preview: PREVIEW };
      }),
    probe: hooks.probe ??
      (async (url) => {
        calls.push(`probe:${url}`);
        return hooks.probeHealthy ?? true;
      }),
    isFatalStartError: hooks.isFatalStartError ?? isTunnelRateLimited,
    onTunnel: (next) => {
      calls.push(`onTunnel:${next.url}`);
    },
    onStopped: (message) => {
      stopped.push(message);
    },
    onError: (error) => {
      errors.push(error);
    },
    log: (line) => {
      calls.push(`log:${line}`);
    },
    logError: (line) => {
      calls.push(`error:${line}`);
    },
    sleep: async (ms) => {
      now += ms;
      calls.push(`sleep:${ms}`);
    },
    now: () => now,
  });
  return { sup, calls, tunnels, stopped, errors, advance: (ms) => { now += ms; } };
}

const startsOf = (calls: string[]): string[] => calls.filter((call) => call.startsWith('start:'));

describe('DevTunnelSupervisor (the 30/9/26 restart-storm regression)', () => {
  it('a killed old tunnel firing exit never causes a second restart', async () => {
    const { sup, calls, advance } = supervisorHarness({ probeHealthy: false });
    const old = fakeWatchedTunnel(calls, OLD_URL);
    sup.watch(old.tunnel);
    advance(61_000);
    await sup.tick();
    await sup.tick();
    expect(startsOf(calls)).toHaveLength(1);
    // The stop the restart issued fired the old tunnel's exit; firing it
    // again (or ticking healthy) must not restart.
    old.fireExit();
    await sup.tick();
    await sup.tick();
    expect(startsOf(calls)).toHaveLength(1);
  });

  it('60s of healthy tunnels cause zero restarts', async () => {
    const { sup, calls, advance } = supervisorHarness({ probeHealthy: true });
    sup.watch(fakeWatchedTunnel(calls, OLD_URL).tunnel);
    for (let step = 0; step < 6; step++) {
      advance(10_000);
      await sup.tick();
    }
    expect(startsOf(calls)).toHaveLength(0);
    expect(calls.filter((call) => call.startsWith('reregister:'))).toHaveLength(0);
  });

  it('a fresh tunnel gets a grace period: misses count only after it answers once or 60s pass', async () => {
    const { sup, calls, advance } = supervisorHarness({ probeHealthy: false });
    sup.watch(fakeWatchedTunnel(calls, OLD_URL).tunnel);
    for (let step = 0; step < 5; step++) {
      advance(10_000);
      await sup.tick();
    }
    expect(startsOf(calls)).toHaveLength(0);
    advance(11_000);
    await sup.tick();
    await sup.tick();
    expect(startsOf(calls)).toHaveLength(1);
  });

  it('an exit of the watched tunnel restarts once, then watches the new tunnel', async () => {
    const { sup, calls, tunnels } = supervisorHarness({ probeHealthy: true });
    const old = fakeWatchedTunnel(calls, OLD_URL);
    sup.watch(old.tunnel);
    await sup.notifyExit(old.tunnel);
    expect(startsOf(calls)).toHaveLength(1);
    expect(calls).toContain(`onTunnel:${tunnels[0]?.url}`);
    // The new tunnel is watched: its exit restarts, the old one's does not.
    old.fireExit();
    expect(startsOf(calls)).toHaveLength(1);
    await sup.notifyExit(tunnels[0] as Tunnel);
    expect(startsOf(calls)).toHaveLength(2);
  });

  it('at most one restart in flight: exits and ticks during a restart do nothing', async () => {
    let release!: (tunnel: Tunnel) => void;
    const gate = new Promise<Tunnel>((resolve) => {
      release = resolve;
    });
    const replacement = fakeWatchedTunnel([], NEW_URL).tunnel;
    const { sup, calls } = supervisorHarness({
      probeHealthy: true,
      startTunnel: () => {
        calls.push('start');
        return gate;
      },
    });
    const old = fakeWatchedTunnel(calls, OLD_URL);
    sup.watch(old.tunnel);
    const pending = sup.notifyExit(old.tunnel);
    for (let flush = 0; flush < 20 && !calls.includes('start'); flush++) await Promise.resolve();
    expect(calls.filter((call) => call === 'start')).toHaveLength(1);
    await sup.tick();
    await sup.notifyExit(old.tunnel);
    expect(calls.filter((call) => call === 'start')).toHaveLength(1);
    release(replacement);
    await pending;
    expect(calls).toContain(`onTunnel:${NEW_URL}`);
  });

  it('caps restarts at 3 per 10 minutes, then stops with a clear message', async () => {
    const { sup, calls, tunnels, stopped } = supervisorHarness({ probeHealthy: true });
    const old = fakeWatchedTunnel(calls, OLD_URL);
    sup.watch(old.tunnel);
    await sup.notifyExit(old.tunnel);
    await sup.notifyExit(tunnels[0] as Tunnel);
    await sup.notifyExit(tunnels[1] as Tunnel);
    expect(startsOf(calls)).toHaveLength(MAX_TUNNEL_RESTARTS_PER_WINDOW);
    await sup.notifyExit(tunnels[2] as Tunnel);
    expect(startsOf(calls)).toHaveLength(MAX_TUNNEL_RESTARTS_PER_WINDOW);
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toContain(`${MAX_TUNNEL_RESTARTS_PER_WINDOW} tunnel starts`);
    // Re-register ran exactly once per successful restart — never a loop.
    expect(calls.filter((call) => call.startsWith('reregister:'))).toHaveLength(MAX_TUNNEL_RESTARTS_PER_WINDOW);
    // Stopped means stopped: further exits and ticks do nothing.
    await sup.notifyExit(tunnels[2] as Tunnel);
    await sup.tick();
    expect(startsOf(calls)).toHaveLength(MAX_TUNNEL_RESTARTS_PER_WINDOW);
    expect(stopped).toHaveLength(1);
  });

  it('a refused start stops supervision at once: one attempt, no re-register', async () => {
    const reregister = vi.fn(async (_url: string) => ({ preview: PREVIEW }));
    const { sup, calls, stopped } = supervisorHarness({
      probeHealthy: true,
      startTunnel: async () => {
        calls.push('start');
        throw new Error('ERROR 1015: temporarily banned');
      },
      reregister,
    });
    const watched = fakeWatchedTunnel(calls, OLD_URL);
    sup.watch(watched.tunnel);
    await sup.notifyExit(watched.tunnel);
    expect(calls.filter((call) => call === 'start')).toHaveLength(1);
    expect(reregister).not.toHaveBeenCalled();
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toContain('rate-limiting');
  });

  it('a 429 re-register is attempted once, logged, and keeps the tunnel', async () => {
    const reregister = vi.fn(async (_url: string): Promise<{ preview: string | null }> => {
      throw new Error('Too Many Attempts.');
    });
    const errors: string[] = [];
    const old = fakeTunnel(OLD_URL);
    const next = fakeTunnel(NEW_URL);
    const result = await restartDevTunnel({
      oldTunnel: old.tunnel,
      start: async () => next.tunnel,
      stopApp: () => {},
      startApp: async () => ({ stop: () => {} }),
      waitForApp: async () => true,
      reregister,
      log: () => {},
      logError: (line) => errors.push(line),
      sleep: async () => {},
    });
    expect(result.tunnel.url).toBe(NEW_URL);
    expect(reregister).toHaveBeenCalledTimes(1);
    expect(errors).toEqual(['Re-register after tunnel restart failed: Too Many Attempts.']);
    expect(next.stopped).toEqual([]);
  });

  it('a fatal start short-circuits the retry loop with TunnelRateLimitedError', async () => {
    const old = fakeTunnel(OLD_URL);
    let starts = 0;
    const error = await restartDevTunnel({
      oldTunnel: old.tunnel,
      start: async () => {
        starts += 1;
        throw new Error('HTTP 429');
      },
      stopApp: () => {},
      startApp: async () => ({ stop: () => {} }),
      waitForApp: async () => true,
      reregister: async () => ({ preview: null }),
      log: () => {},
      logError: () => {},
      sleep: async () => {},
    }).then(
      () => null,
      (caught: Error) => caught,
    );
    expect(error).toBeInstanceOf(TunnelRateLimitedError);
    expect(starts).toBe(1);
    expect(error?.message).toContain('rate-limiting');
  });

  it('an exit-triggered terminal failure routes to onError: no hang, no unhandled rejection', async () => {
    const reregister = vi.fn(async (_url: string) => ({ preview: PREVIEW }));
    const { sup, calls, stopped, errors } = supervisorHarness({ probeHealthy: true, appHealthy: false, reregister });
    const watched = fakeWatchedTunnel(calls, OLD_URL);
    sup.watch(watched.tunnel);
    // Resolves normally (nothing thrown, nothing unhandled) …
    await sup.notifyExit(watched.tunnel);
    // … but the run would fail through onError instead of hanging.
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toContain('did not answer /health after the tunnel restart');
    expect(reregister).not.toHaveBeenCalled();
    expect(stopped).toHaveLength(0);
    // Terminal means terminal: later ticks start nothing.
    await sup.tick();
    expect(startsOf(calls)).toHaveLength(1);
    expect(errors).toHaveLength(1);
  });

  it('attempts count toward the window: persistent failures stop, never give up into a loop', async () => {
    const reregister = vi.fn(async (_url: string) => ({ preview: PREVIEW }));
    const { sup, calls, stopped, errors } = supervisorHarness({
      probeHealthy: true,
      startTunnel: async () => {
        calls.push('start');
        throw new Error('boom');
      },
      reregister,
    });
    const watched = fakeWatchedTunnel(calls, OLD_URL);
    sup.watch(watched.tunnel);
    await sup.notifyExit(watched.tunnel);
    // Three start attempts consumed the window; the fourth tripped the cap
    // instead of running the inner retries out (5) into a give-up loop.
    expect(calls.filter((call) => call === 'start')).toHaveLength(MAX_TUNNEL_RESTARTS_PER_WINDOW);
    expect(reregister).not.toHaveBeenCalled();
    expect(errors).toHaveLength(0);
    expect(stopped).toHaveLength(1);
    expect(stopped[0]).toContain('tunnel starts');
    // Stopped means stopped.
    await sup.tick();
    expect(calls.filter((call) => call === 'start')).toHaveLength(MAX_TUNNEL_RESTARTS_PER_WINDOW);
  });

  it('teardown mid-restart kills unpublished children and publishes nothing', async () => {
    let release!: (tunnel: Tunnel) => void;
    const gate = new Promise<Tunnel>((resolve) => {
      release = resolve;
    });
    const { sup, calls } = supervisorHarness({
      probeHealthy: true,
      startTunnel: () => {
        calls.push('start');
        return gate;
      },
    });
    const replacement = fakeWatchedTunnel(calls, NEW_URL);
    const old = fakeWatchedTunnel(calls, OLD_URL);
    sup.watch(old.tunnel);
    const pending = sup.notifyExit(old.tunnel);
    for (let flush = 0; flush < 20 && !calls.includes('start'); flush++) await Promise.resolve();
    sup.abort();
    release(replacement.tunnel);
    await pending;
    // Nothing published: the new handles were killed instead.
    expect(calls.filter((call) => call.startsWith('onTunnel:'))).toHaveLength(0);
    expect(calls).toContain(`stop:${NEW_URL}`);
    expect(calls).toContain('stopNewApp');
    // The old handles were stopped by the restart itself, before the abort.
    expect(calls).toContain(`stop:${OLD_URL}`);
    expect(calls).toContain('stopOldApp');
  });

  it('overlapping slow probes skip instead of double-counting a miss', async () => {
    const resolvers: Array<(healthy: boolean) => void> = [];
    const probes: string[] = [];
    const { sup, calls, advance } = supervisorHarness({
      probe: (url) => {
        probes.push(url);
        return new Promise<boolean>((resolve) => {
          resolvers.push(resolve);
        });
      },
    });
    sup.watch(fakeWatchedTunnel(calls, OLD_URL).tunnel);
    advance(61_000);
    const first = sup.tick();
    const second = sup.tick();
    await Promise.resolve();
    // The second tick saw the probe in flight and stood down.
    expect(probes).toHaveLength(1);
    resolvers[0]?.(false);
    await first;
    await second;
    // One miss recorded — no restart yet.
    expect(startsOf(calls)).toHaveLength(0);
    const third = sup.tick();
    for (let flush = 0; flush < 20 && resolvers.length < 2; flush++) await Promise.resolve();
    resolvers[1]?.(false);
    await third;
    expect(startsOf(calls)).toHaveLength(1);
  });
});

describe('createDeployQueue (toml saves queue behind re-registers)', () => {
  it('runs units in order and survives a rejection', async () => {
    const queue = createDeployQueue();
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = queue(async () => {
      order.push('first-start');
      await gate;
      order.push('first-end');
      return 'first';
    });
    const second = queue(async () => {
      order.push('second');
      return 'second';
    });
    for (let flush = 0; flush < 20 && !order.includes('first-start'); flush++) await Promise.resolve();
    expect(order).toEqual(['first-start']);
    release();
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(order).toEqual(['first-start', 'first-end', 'second']);

    const failing = queue(async () => {
      throw new Error('deploy refused');
    });
    await expect(failing).rejects.toThrow('deploy refused');
    await expect(
      queue(async () => {
        order.push('third');
        return 'third';
      }),
    ).resolves.toBe('third');
    expect(order).toContain('third');
  });
});
