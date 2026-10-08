import { spawn as nodeSpawn } from 'node:child_process';
import type { Readable } from 'node:stream';

/**
 * The local half of `queek app dev` (the CLI owns the app process, not just
 * the tunnel). A spawned `[dev].command` with
 * prefixed output, restart-with-backoff on crashes, and a health waiter.
 * `spawn`/`fetch` inject so tests drive the whole lifecycle with fakes.
 */

export interface SpawnedApp {
  readonly pid?: number;
  readonly stdout: Readable | null;
  readonly stderr: Readable | null;
  kill(signal?: string): boolean;
  once(event: 'exit', listener: (code: number | null) => void): unknown;
}

export type SpawnFn = (command: string, options: { cwd: string; env: NodeJS.ProcessEnv; shell: boolean }) => SpawnedApp;

export const defaultSpawn: SpawnFn = (command, options) => nodeSpawn(command, options) as unknown as SpawnedApp;

export type FetchFn = (url: string) => Promise<{ ok: boolean }>;

export interface SupervisedApp {
  /** Stop restarts and SIGTERM the current child (best effort). */
  stop: () => void;
}

function prefixLines(stream: Readable | null, sink: (line: string) => void): void {
  if (!stream) return;
  let buffered = '';
  stream.on('data', (chunk: unknown) => {
    buffered += String(chunk);
    const parts = buffered.split('\n');
    buffered = parts.pop() ?? '';
    for (const line of parts) sink(`[app] ${line}`);
  });
}

/**
 * Run `command` in `cwd` with `env`, forever: a non-zero exit relaunches it
 * (1s → 2s → 4s … capped at 10s; the counter resets after 30s healthy). A
 * clean exit (0) is respected — watchers like `tsx watch` never take it.
 */
export function startSupervised(options: {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  spawn?: SpawnFn;
  log: (line: string) => void;
  logError: (line: string) => void;
}): SupervisedApp {
  const spawnFn = options.spawn ?? defaultSpawn;
  let stopped = false;
  let crashes = 0;
  let timer: NodeJS.Timeout | null = null;
  let child: SpawnedApp | null = null;

  const launch = (): void => {
    if (stopped) return;
    const startedAt = Date.now();
    const proc = spawnFn(options.command, { cwd: options.cwd, env: options.env, shell: true });
    child = proc;
    prefixLines(proc.stdout, options.log);
    prefixLines(proc.stderr, options.logError);
    proc.once('exit', (code: number | null) => {
      child = null;
      if (stopped || code === 0) return;
      if (Date.now() - startedAt > 30_000) crashes = 0;
      const waitMs = Math.min(1000 * 2 ** crashes, 10_000);
      crashes += 1;
      options.logError(`[app] exited (code ${code ?? 'unknown'}) — restarting in ${waitMs / 1000}s (attempt ${crashes}).`);
      timer = setTimeout(launch, waitMs);
      timer.unref?.();
    });
  };

  launch();
  return {
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      try {
        child?.kill('SIGTERM');
      } catch {
        // Already gone — the tunnel stop below is what matters.
      }
      child = null;
    },
  };
}

/** Poll `url` until it answers 2xx (the app is up) or `timeoutMs` passes. */
export async function waitForHealthy(url: string, timeoutMs: number, fetchFn?: FetchFn): Promise<boolean> {
  const get = fetchFn ?? (async (target: string) => fetch(target));
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await get(url);
      if (response.ok) return true;
    } catch {
      // Not listening yet — fall through to the wait.
    }
    if (Date.now() > deadline) return false;
    await new Promise((done) => setTimeout(done, 1000));
  }
}
