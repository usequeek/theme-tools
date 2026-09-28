import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, readFileSync } from 'node:fs';

/**
 * `app dev` serves the app's tunnel URL to Queek (tunnel URLs pass the same
 * `assertAppUrl`: https only). `cloudflared` (Cloudflare Quick Tunnels,
 * no account) is used when installed; otherwise the caller passes `--url`
 * from any tunnel, or develops knowing Queek cannot call back to localhost.
 */
export interface Tunnel {
  url: string;
  how: 'flag' | 'cloudflared';
  /** Kill the tunnel (cloudflared only; a `--url` tunnel is yours). */
  stop: () => void;
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
export async function startCloudflared(port: number, logFile: string): Promise<Tunnel> {
  const log = createWriteStream(logFile, { flags: 'a' });
  let child: ChildProcess;
  try {
    child = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`], {
      detached: true,
      stdio: ['ignore', log, log],
    });
  } catch {
    throw new Error('Could not start `cloudflared` (is it installed?). Pass --url with a tunnel URL from another tool instead.');
  }
  child.unref();
  const stop = (): void => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill();
    }
  };

  const deadline = Date.now() + 25_000;
  for (;;) {
    if (existsSync(logFile)) {
      const url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(readFileSync(logFile, 'utf8'))?.[0];
      if (url) return { url, how: 'cloudflared', stop };
    }
    if (child.exitCode !== null) {
      stop();
      throw new Error(`cloudflared exited before printing a tunnel URL (see ${logFile}). Pass --url instead.`);
    }
    if (Date.now() > deadline) {
      stop();
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
