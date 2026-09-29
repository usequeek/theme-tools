import { spawn, spawnSync } from 'node:child_process';
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
/** One line, three OSes — a missing tunnel binary must never read as a crash. */
const MISSING_CLOUDFLARED =
  'No cloudflared on PATH — install it (macOS: `brew install cloudflared`; Windows: `winget install --id Cloudflare.cloudflared`; Linux: the .deb/.rpm at https://github.com/cloudflare/cloudflared/releases) or pass --url with a tunnel URL from another tool.';

export async function startCloudflared(port: number, logFile: string): Promise<Tunnel> {
  // Fail fast: spawn() reports a missing binary as an async 'error' event,
  // never a sync throw, so without this the process crashes instead of
  // printing the install line.
  if (!hasCloudflared()) throw new Error(MISSING_CLOUDFLARED);
  const log = createWriteStream(logFile, { flags: 'a' });
  const child = spawn('cloudflared', ['tunnel', '--url', `http://127.0.0.1:${port}`], {
    detached: true,
    stdio: ['ignore', log, log],
  });
  // The binary can vanish between the check and the spawn (or die on exec):
  // capture the event so the loop below reports it instead of crashing.
  let spawnError: Error | null = null;
  child.once('error', (error: Error) => {
    spawnError = error;
  });
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
    if (spawnError) {
      stop();
      throw new Error(`${MISSING_CLOUDFLARED} (${(spawnError as Error).message})`);
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
