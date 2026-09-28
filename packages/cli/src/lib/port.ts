import { createServer } from 'node:net';

/** First port probed when `--port` is not given. */
export const FIRST_PREVIEW_PORT = 7833;
/** Last port probed when `--port` is not given (20 ports, 7833–7852). */
export const LAST_PREVIEW_PORT = 7852;

/** True when nothing on `host` is listening on `port` — a throwaway `net` server binds and closes. */
function isFree(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
}

function portBusy(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: 'PORT_BUSY' });
}

/** The ports probed when `--port` is not given; the default is 7833–7852. */
export interface PortRange {
  first: number;
  last: number;
}

/**
 * The port the preview serves on. A requested port (the `--port` flag or
 * `QUEEK_THEME_PORT`) is strict — a busy one is an error, not a silent move.
 * Otherwise the first free port in the range wins, so a busy default does not
 * block a developer who already has something running there.
 */
export async function pickPort({ host, requested, range }: { host: string; requested?: number; range?: PortRange }): Promise<number> {
  if (requested !== undefined) {
    if (await isFree(host, requested)) return requested;
    throw portBusy(`Port ${requested} is in use. Pass another --port, or leave --port out to use the next free one.`);
  }
  const { first, last } = range ?? { first: FIRST_PREVIEW_PORT, last: LAST_PREVIEW_PORT };
  for (let port = first; port <= last; port++) {
    if (await isFree(host, port)) return port;
  }
  throw portBusy(`Ports ${first}–${last} are all in use. Pass --port with a free one.`);
}
