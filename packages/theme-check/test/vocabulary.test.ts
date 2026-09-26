import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  bundledVersion,
  parseEndpointPayload,
  parseVocabularyData,
  resolveVocabulary,
  vocabularyCacheDir,
  type BusinessVocabularyData,
} from '../src/vocabulary.js';

/**
 * The live vocabulary resolver, against a fake fetch — no test here touches
 * the network. The global fetch is stubbed to throw, so any resolve that
 * reaches for the real network fails the test instead of hitting production.
 */

const DATA = (version: string): BusinessVocabularyData => ({
  version,
  services: ['laundry', 'shop'],
  catalogue: { fashion: ['shoes'] },
  subcategories: {},
  root_service: {},
  labels: { laundry: 'Laundry', shop: 'Shop', fashion: 'Fashion', shoes: 'Shoes' },
});

const payload = (version: string): { status: string; data: BusinessVocabularyData } => ({ status: 'ok', data: DATA(version) });

const jsonResponse = (value: unknown, status = 200): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

interface Seen {
  url: string;
  headers: Record<string, string>;
}
function fakeFetch(handler: (seen: Seen) => Response | Promise<Response>): { fetch: typeof fetch; calls: Seen[] } {
  const calls: Seen[] = [];
  const fetch = (async (url: unknown, init?: RequestInit): Promise<Response> => {
    const headers = { ...(init?.headers as Record<string, string> | undefined) };
    const seen = { url: String(url), headers };
    calls.push(seen);
    return handler(seen);
  }) as typeof fetch;
  return { fetch, calls };
}

const cacheIn = (): string => mkdtempSync(join(tmpdir(), 'vocab-cache-'));

const realFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error('network in tests: inject a fake fetch');
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe('vocabularyCacheDir', () => {
  it('uses XDG_CACHE_HOME or ~/.cache on Linux, Library/Caches on macOS, LOCALAPPDATA on Windows', () => {
    expect(vocabularyCacheDir({ env: { XDG_CACHE_HOME: '/x' }, platform: 'linux' })).toBe(join('/x', 'usequeek'));
    expect(vocabularyCacheDir({ env: {}, platform: 'linux' })).toBe(join(homedir(), '.cache', 'usequeek'));
    expect(vocabularyCacheDir({ env: {}, platform: 'darwin' })).toBe(join(homedir(), 'Library', 'Caches', 'usequeek'));
    expect(vocabularyCacheDir({ env: { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, platform: 'win32' })).toBe(
      join('C:\\Users\\a\\AppData\\Local', 'usequeek'),
    );
  });
});

describe('resolveVocabulary live', () => {
  it('writes the cache on a 200, then serves the fresh cache without fetching', async () => {
    const dir = cacheIn();
    const { fetch, calls } = fakeFetch(() => jsonResponse(payload('v1')));
    const first = await resolveVocabulary({ mode: 'live', fetch, cacheDir: dir });
    expect(first.source).toBe('live');
    expect(first.version).toBe('v1');
    expect(first.notice).toBeUndefined();
    const stored = JSON.parse(readFileSync(join(dir, 'vocabulary.json'), 'utf8')) as { version: string; fetchedAt: number; vocabulary: BusinessVocabularyData };
    expect(stored.version).toBe('v1');
    expect(stored.vocabulary).toEqual(DATA('v1'));

    const second = await resolveVocabulary({ mode: 'live', fetch, cacheDir: dir });
    expect(second.source).toBe('cache');
    expect(second.version).toBe('v1');
    expect(calls).toHaveLength(1);
  });

  it('keeps the cache on a 304', async () => {
    const dir = cacheIn();
    const seed = fakeFetch(() => jsonResponse(payload('v9')));
    await resolveVocabulary({ mode: 'live', fetch: seed.fetch, cacheDir: dir, force: true });
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 304 }));
    const resolved = await resolveVocabulary({ mode: 'live', fetch, cacheDir: dir, force: true });
    expect(resolved.source).toBe('cache');
    expect(resolved.version).toBe('v9');
    expect(resolved.notice).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  it('sends If-None-Match quoted from the stored version, never the raw header', async () => {
    const dir = cacheIn();
    const seed = fakeFetch(() => jsonResponse(payload('d1f9c8ee')));
    await resolveVocabulary({ mode: 'live', fetch: seed.fetch, cacheDir: dir, force: true });
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 304 }));
    await resolveVocabulary({ mode: 'live', fetch, cacheDir: dir, force: true });
    expect(calls[0].headers['If-None-Match']).toBe('"d1f9c8ee"');
    expect(calls[0].headers['If-None-Match']).not.toContain('W/');
    expect(calls[0].headers['If-None-Match']).not.toContain('-br');
  });

  it('falls back to the cache on timeout, with a one-line notice', async () => {
    const dir = cacheIn();
    const seed = fakeFetch(() => jsonResponse(payload('v7')));
    await resolveVocabulary({ mode: 'live', fetch: seed.fetch, cacheDir: dir, force: true });
    const hanging = fakeFetch(() => new Promise<Response>(() => {}));
    const resolved = await resolveVocabulary({ mode: 'live', fetch: hanging.fetch, cacheDir: dir, force: true, timeoutMs: 30 });
    expect(resolved.source).toBe('cache');
    expect(resolved.version).toBe('v7');
    expect(resolved.notice).toContain('cached copy');
    expect(resolved.notice).not.toContain('\n');
  });

  it('falls back to the bundled snapshot with no cache and an error, with a one-line notice', async () => {
    const failing = fakeFetch(() => {
      throw new Error('boom');
    });
    const resolved = await resolveVocabulary({ mode: 'live', fetch: failing.fetch, cacheDir: cacheIn() });
    expect(resolved.source).toBe('bundled');
    expect(resolved.version).toBe(bundledVersion());
    expect(resolved.notice).toContain('bundled copy');
    expect(resolved.notice).not.toContain('\n');
  });

  it('never caches a bad payload, falling back instead', async () => {
    const dir = cacheIn();
    const seed = fakeFetch(() => jsonResponse(payload('v3')));
    await resolveVocabulary({ mode: 'live', fetch: seed.fetch, cacheDir: dir, force: true });
    const before = readFileSync(join(dir, 'vocabulary.json'), 'utf8');
    const bad = fakeFetch(() => jsonResponse({ status: 'ok', data: { services: [] } }));
    const resolved = await resolveVocabulary({ mode: 'live', fetch: bad.fetch, cacheDir: dir, force: true });
    expect(resolved.source).toBe('cache');
    expect(resolved.version).toBe('v3');
    expect(resolved.notice).toContain('invalid');
    expect(readFileSync(join(dir, 'vocabulary.json'), 'utf8')).toBe(before);
  });

  it('leaves no cache file behind for a bad payload with no cache', async () => {
    const dir = cacheIn();
    const bad = fakeFetch(() => jsonResponse({ status: 'ok', data: { version: 42 } }));
    const resolved = await resolveVocabulary({ mode: 'live', fetch: bad.fetch, cacheDir: dir });
    expect(resolved.source).toBe('bundled');
    expect(resolved.notice).toBeDefined();
    let cached: string | null = null;
    try {
      cached = readFileSync(join(dir, 'vocabulary.json'), 'utf8');
    } catch {
      cached = null;
    }
    expect(cached).toBeNull();
  });

  it('falls back on an unexpected status and on a 304 with nothing cached', async () => {
    const dir = cacheIn();
    const seed = fakeFetch(() => jsonResponse(payload('v5')));
    await resolveVocabulary({ mode: 'live', fetch: seed.fetch, cacheDir: dir, force: true });
    const error = fakeFetch(() => new Response('nope', { status: 500 }));
    const fallen = await resolveVocabulary({ mode: 'live', fetch: error.fetch, cacheDir: dir, force: true });
    expect(fallen.source).toBe('cache');
    expect(fallen.notice).toContain('500');

    const bare = fakeFetch(() => new Response(null, { status: 304 }));
    const empty = await resolveVocabulary({ mode: 'live', fetch: bare.fetch, cacheDir: cacheIn() });
    expect(empty.source).toBe('bundled');
    expect(empty.notice).toBeDefined();
  });

  it('force skips the fresh cache but still revalidates with If-None-Match', async () => {
    const dir = cacheIn();
    const seed = fakeFetch(() => jsonResponse(payload('v2')));
    await resolveVocabulary({ mode: 'live', fetch: seed.fetch, cacheDir: dir });
    const { fetch, calls } = fakeFetch(() => jsonResponse(payload('v4')));
    const resolved = await resolveVocabulary({ mode: 'live', fetch, cacheDir: dir, force: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].headers['If-None-Match']).toBe('"v2"');
    expect(resolved.source).toBe('live');
    expect(resolved.version).toBe('v4');
  });
});

describe('resolveVocabulary file and offline', () => {
  it('a pinned file wins, and is validated', async () => {
    const dir = cacheIn();
    const file = join(dir, 'pinned.json');
    writeFileSync(file, JSON.stringify(DATA('pinned')));
    const resolved = await resolveVocabulary({ mode: 'live', file, cacheDir: dir });
    expect(resolved.source).toBe('file');
    expect(resolved.version).toBe('pinned');
    expect(resolved.vocabulary.services).toEqual(['laundry', 'shop']);
  });

  it('a bad pinned file throws, never silently falls back', async () => {
    const dir = cacheIn();
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ services: [] }));
    await expect(resolveVocabulary({ file: bad, cacheDir: dir })).rejects.toThrow(/vocabulary/);
    await expect(resolveVocabulary({ file: join(dir, 'missing.json'), cacheDir: dir })).rejects.toThrow(/cannot read/);
  });

  it('offline uses the bundled snapshot without fetching', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse(payload('live')));
    const resolved = await resolveVocabulary({ mode: 'offline', fetch, cacheDir: cacheIn() });
    expect(resolved.source).toBe('bundled');
    expect(resolved.version).toBe(bundledVersion());
    expect(resolved.notice).toBeUndefined();
    expect(calls).toHaveLength(0);
  });
});

describe('payload validation', () => {
  it('rejects junk strictly, never caching it', () => {
    for (const junk of [null, [], 'x', {}, { data: null }, { status: 'ok', data: { services: ['a'] } }, { status: 'ok', data: { ...DATA('v'), services: [] } }]) {
      expect(() => parseEndpointPayload(junk), JSON.stringify(junk)).toThrow();
    }
    expect(parseEndpointPayload(payload('ok'))).toEqual(DATA('ok'));
    expect(() => parseVocabularyData({ services: ['a'], catalogue: {}, subcategories: {} }, { requireVersion: true })).toThrow(/version/);
    expect(parseVocabularyData({ services: ['a'], catalogue: {}, subcategories: {} }, { requireVersion: false }).services).toEqual(['a']);
  });
});

describe('bundle', () => {
  it('ships the synced S1 snapshot with its version', async () => {
    expect(bundledVersion()).toBe('d1f9c8eefc91ed3b2c834345458c62343f465ce6');
    const { bundledVocabulary } = await import('../src/vocabulary.js');
    expect(bundledVocabulary().services).toHaveLength(16);
    expect(bundledVocabulary().services).toContain('shop');
  });
});
