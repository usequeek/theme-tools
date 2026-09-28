import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { FIRST_PREVIEW_PORT, pickPort } from '../src/lib/port.js';

const opened: Server[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
});

/** Hold a port on 127.0.0.1, the way another process would. */
async function occupy(port: number): Promise<Server> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  opened.push(server);
  return server;
}

describe('pickPort', () => {
  it('returns the default 7833 when it is free', async () => {
    await expect(pickPort({ host: '127.0.0.1' })).resolves.toBe(FIRST_PREVIEW_PORT);
  });

  it('skips a busy default and returns the next free port', async () => {
    await occupy(7833);
    await expect(pickPort({ host: '127.0.0.1' })).resolves.toBe(7834);
  });

  it('returns a requested port when it is free', async () => {
    await expect(pickPort({ host: '127.0.0.1', requested: 7841 })).resolves.toBe(7841);
  });

  it('throws PORT_BUSY when the requested port is busy', async () => {
    await occupy(7841);
    const error = await pickPort({ host: '127.0.0.1', requested: 7841 }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { code?: string }).code).toBe('PORT_BUSY');
    expect((error as Error).message).toBe('Port 7841 is in use. Pass another --port, or leave --port out to use the next free one.');
  });
});
