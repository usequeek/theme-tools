import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';

/**
 * `app dev` serves the app's tunnel URL to Queek (https only, like every app
 * URL). `cloudflared` (Cloudflare Quick Tunnels,
 * no account) is used when installed; otherwise the caller passes `--url`
 * from any tunnel, or develops knowing Queek cannot call back to localhost.
 */
export interface Tunnel {
  url: string;
  how: 'flag' | 'cloudflared';
  /** Kill the tunnel (cloudflared only; a `--url` tunnel is yours). */
  stop: () => void;
  /** Fires when the cloudflared child exits (absent for `--url` tunnels, which the CLI does not own). */
  onExit?: (listener: () => void) => void;
}

const noop = (): void => {};

export function hasCloudflared(): boolean {
  try {
    return spawnSync('cloudflared', ['--version'], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

/**
 * Start a Quick Tunnel for `port` in the background (log at `logFile`),
 * wait up to 25s for its public URL, and hand back a stopper. The tunnel
 * lives until `stop()` — `app dev` wires that to Ctrl+C.
 */
/** One line, three OSes — a missing tunnel binary must never read as a crash. */
const MISSING_CLOUDFLARED =
  'No cloudflared on PATH — install it (macOS: `brew install cloudflared`; Windows: `winget install --id Cloudflare.cloudflared`; Linux: the .deb/.rpm at https://github.com/cloudflare/cloudflared/releases) or pass --url with a tunnel URL from another tool.';

export async function startCloudflared(port: number, logFile: string): Promise<Tunnel> {
  // Fail fast: spawn() reports a missing binary as an async 'error' event,
  // never a sync throw, so without this the process crashes instead of
  // printing the install line.
  if (!hasCloudflared()) throw new Error(MISSING_CLOUDFLARED);
  // spawn() needs an OPEN descriptor: a fresh WriteStream has fd null until
  // its async 'open', which spawn rejects. The child keeps its own copy, so
  // the parent closes its handle right after spawning.
  // Fresh per run: the URL is read back from this file, and an appended
  // log would hand back an earlier run's (dead) tunnel URL first.
  const log = openSync(logFile, 'w');
  let child: ReturnType<typeof spawn>;
  try {
    child = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`], {
      detached: true,
      stdio: ['ignore', log, log],
    });
  } finally {
    closeSync(log);
  }
  // The binary can vanish between the check and the spawn (or die on exec):
  // capture the event so the loop below reports it instead of crashing.
  let spawnError: Error | null = null;
  child.once('error', (error: Error) => {
    spawnError = error;
  });
  // `queek app dev` restarts a dead tunnel: subscribers learn the child
  // exited (a dead tunnel never fails the run by itself).
  const exitListeners = new Set<() => void>();
  child.once('exit', () => {
    for (const listener of exitListeners) {
      try {
        listener();
      } catch {
        /* a dead tunnel never fails the run */
      }
    }
  });
  child.unref();
  const stop = (): void => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill();
    }
  };

  const onExit = (listener: () => void): void => {
    exitListeners.add(listener);
  };
  const deadline = Date.now() + 25_000;
  for (;;) {
    if (existsSync(logFile)) {
      const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(readFileSync(logFile, 'utf8'))?.[0];
      if (url) return { url, how: 'cloudflared', stop, onExit };
    }
    if (spawnError) {
      stop();
      throw new Error(`${MISSING_CLOUDFLARED} (${(spawnError as Error).message})`);
    }
    if (child.exitCode !== null) {
      stop();
      // A refused start says so in the error, not the log tail the caller
      // would read after the next truncate: carry it in the throw.
      if (matchTunnelRateLimited(readLogTail(logFile))) {
        throw new Error(`cloudflared refused a new tunnel (rate limited — see ${logFile}). Wait a few minutes and run again, or pass --url instead.`);
      }
      throw new Error(`cloudflared exited before printing a tunnel URL (see ${logFile}). Pass --url instead.`);
    }
    if (Date.now() > deadline) {
      stop();
      if (matchTunnelRateLimited(readLogTail(logFile))) {
        throw new Error(`cloudflared did not print a tunnel URL within 25s (rate limited — see ${logFile}). Wait a few minutes and run again, or pass --url instead.`);
      }
      throw new Error(`Timed out waiting for a cloudflared URL (see ${logFile}). Pass --url instead.`);
    }
    await new Promise((done) => setTimeout(done, 500));
  }
}

/** A `--url` tunnel the CLI does not own: nothing to stop. */
export function manualTunnel(url: string): Tunnel {
  if (!url.startsWith('https://')) throw new Error('The --url tunnel must be an https URL (Queek calls back over https).');
  return { url: url.replace(/\/+$/, ''), how: 'flag', stop: noop };
}

/**
 * The one matcher for refused quick-tunnel creation (HTTP 429, error 1015,
 * "Too Many Attempts"): used on start errors and log tails alike, so a bare
 * `429` in either place stops supervision instead of extending the ban.
 */
export function matchTunnelRateLimited(text: string): boolean {
  return /\b(1015|429)\b|rate.?limit|too many/i.test(text);
}

/**
 * The log tail a failure throw carries: read synchronously with the failure,
 * never after a later start truncates the file — a late-flushed 1015/429
 * must not be missed.
 */
function readLogTail(logFile: string): string {
  try {
    return readFileSync(logFile, 'utf8').slice(-4000);
  } catch {
    return '';
  }
}
