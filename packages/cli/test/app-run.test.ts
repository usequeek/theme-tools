import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { startSupervised, waitForHealthy, type SpawnedApp, type SpawnFn } from '../src/lib/app-run.js';

class FakeChild implements SpawnedApp {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kills: string[] = [];
  readonly commands: string[] = [];
  private readonly listeners: Record<string, Array<(code: number | null) => void>> = {};

  once(event: 'exit', listener: (code: number | null) => void): unknown {
    (this.listeners[event] ??= []).push(listener);
    return this;
  }

  exit(code: number | null): void {
    for (const listener of this.listeners.exit ?? []) listener(code);
  }

  kill(signal = 'SIGTERM'): boolean {
    this.kills.push(signal);
    return true;
  }
}

function harness(): { children: FakeChild[]; calls: Array<{ command: string; cwd: string; env: NodeJS.ProcessEnv }>; spawn: SpawnFn } {
  const children: FakeChild[] = [];
  const calls: Array<{ command: string; cwd: string; env: NodeJS.ProcessEnv }> = [];
  const spawn: SpawnFn = (command, options) => {
    const child = new FakeChild();
    children.push(child);
    calls.push({ command, cwd: options.cwd, env: options.env });
    return child;
  };
  return { children, calls, spawn };
}

describe('startSupervised (the app process `queek app dev` owns)', () => {
  it('spawns the [dev] command in the app dir with the injected env', () => {
    const { children, calls, spawn } = harness();
    const logs: string[] = [];
    const supervised = startSupervised({
      command: 'tsx watch src/index.ts',
      cwd: '/app',
      env: { ...process.env, APP_BASE_URL: 'https://x.trycloudflare.com', PORT: '3000' },
      spawn,
      log: (line) => logs.push(line),
      logError: (line) => logs.push(line),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe('tsx watch src/index.ts');
    expect(calls[0]?.cwd).toBe('/app');
    expect(calls[0]?.env.APP_BASE_URL).toBe('https://x.trycloudflare.com');
    children[0]?.stdout.emit('data', 'listening\non 3000\n');
    expect(logs).toEqual(['[app] listening', '[app] on 3000']);
    supervised.stop();
    expect(children[0]?.kills).toEqual(['SIGTERM']);
  });

  it('restarts a crash with backoff and respects a clean exit', async () => {
    const { children, spawn } = harness();
    const errors: string[] = [];
    const supervised = startSupervised({
      command: 'tsx watch src/index.ts',
      cwd: '/app',
      env: {},
      spawn,
      log: () => {},
      logError: (line) => errors.push(line),
    });
    children[0]?.exit(1);
    expect(errors).toEqual(['[app] exited (code 1) — restarting in 1s (attempt 1).']);
    await new Promise((done) => setTimeout(done, 1200));
    expect(children).toHaveLength(2);
    children[1]?.exit(0);
    await new Promise((done) => setTimeout(done, 1200));
    expect(children).toHaveLength(2);
    supervised.stop();
  }, 10_000);

  it('stop() kills the child and suppresses the restart', async () => {
    const { children, spawn } = harness();
    const supervised = startSupervised({ command: 'x', cwd: '/app', env: {}, spawn, log: () => {}, logError: () => {} });
    supervised.stop();
    expect(children[0]?.kills).toEqual(['SIGTERM']);
    children[0]?.exit(1);
    await new Promise((done) => setTimeout(done, 1200));
    expect(children).toHaveLength(1);
  }, 10_000);
});

describe('waitForHealthy (/health before the links print)', () => {
  it('resolves true once the app answers 2xx', async () => {
    let hits = 0;
    const fetchFn = vi.fn(async () => {
      hits += 1;
      if (hits < 3) throw new Error('refused');
      return { ok: true };
    });
    await expect(waitForHealthy('http://127.0.0.1:3000/health', 10_000, fetchFn)).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  }, 10_000);

  it('resolves false when the deadline passes', async () => {
    const fetchFn = vi.fn(async () => ({ ok: false }));
    await expect(waitForHealthy('http://127.0.0.1:3000/health', 1500, fetchFn)).resolves.toBe(false);
    expect(fetchFn.mock.calls.length).toBeGreaterThan(1);
  }, 10_000);
});
