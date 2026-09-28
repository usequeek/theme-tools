import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { FIRST_PREVIEW_PORT, LAST_PREVIEW_PORT, pickPort } from '../src/lib/port.js';

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

/** Bind port 0 once: a free ephemeral port, closed before it is returned. */
async function ephemeral(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

/** Try to hold a port; null when something else holds it. */
async function tryOccupy(port: number): Promise<Server | null> {
  const server = createServer();
  const held = await new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => resolve(true));
  });
  if (!held) return null;
  opened.push(server);
  return server;
}

/**
 * A two-port range the test owns: two ephemeral binds, closed, then `p` and
 * `p + 1` both proven free by holding them. Retried while `p + 1` is taken.
 * The default 7833–7852 range is never touched, so a running `queek theme
 * dev` cannot break these tests.
 */
async function ownedRange(): Promise<{ first: number; last: number }> {
  for (let attempt = 0; attempt < 25; attempt++) {
    const first = await ephemeral();
    await ephemeral();
    const held = await Promise.all([tryOccupy(first), tryOccupy(first + 1)]);
    if (held[0] && held[1]) {
      await Promise.all(opened.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
      return { first, last: first + 1 };
    }
    await Promise.all(opened.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
  }
  throw new Error('could not find two adjacent free ports for the test range');
}

describe('pickPort', () => {
  it('returns the range first port when it is free', async () => {
    const range = await ownedRange();
    await expect(pickPort({ host: '127.0.0.1', range })).resolves.toBe(range.first);
  });

  it('skips a busy first port and returns the next free one', async () => {
    const range = await ownedRange();
    await occupy(range.first);
    await expect(pickPort({ host: '127.0.0.1', range })).resolves.toBe(range.last);
  });

  it('throws PORT_BUSY naming the range when every port is busy', async () => {
    const range = await ownedRange();
    await occupy(range.first);
    await occupy(range.last);
    const error = await pickPort({ host: '127.0.0.1', range }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { code?: string }).code).toBe('PORT_BUSY');
    expect((error as Error).message).toBe(`Ports ${range.first}–${range.last} are all in use. Pass --port with a free one.`);
  });

  it('returns a requested port when it is free', async () => {
    const requested = await ephemeral();
    await expect(pickPort({ host: '127.0.0.1', requested })).resolves.toBe(requested);
  });

  it('throws PORT_BUSY when the requested port is busy', async () => {
    const requested = await ephemeral();
    await occupy(requested);
    const error = await pickPort({ host: '127.0.0.1', requested }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { code?: string }).code).toBe('PORT_BUSY');
    expect((error as Error).message).toBe(`Port ${requested} is in use. Pass another --port, or leave --port out to use the next free one.`);
  });

  it('probes 7833–7852 by default', () => {
    expect(FIRST_PREVIEW_PORT).toBe(7833);
    expect(LAST_PREVIEW_PORT).toBe(7852);
  });
});
