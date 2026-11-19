import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MANIFEST_KEYS, sharesKnownQueekOrigin, toManifest } from '../src/lib/app-manifest.js';

// The API holds a byte-identical copy (tests/Fixtures/manifest-parity.json) and runs the same rows
// through AppManifestValidator: change both copies and both pins together.
const FIXTURE = new URL('./fixtures/manifest-parity.json', import.meta.url);
const FIXTURE_SHA256 = 'a284d8f3d5492c8c934b3db171b7625bc98892b97e4dac018493114df23bd2a8';

interface Row { name: string; toml: Record<string, unknown>; manifest: Record<string, unknown>; server_valid: boolean; server_contains: string | null }
const bytes = readFileSync(FIXTURE);
const parity = JSON.parse(bytes.toString('utf8')) as {
  manifest_keys: string[];
  base_toml: Record<string, unknown>;
  rows: Row[];
  origins: Array<{ url: string; shares: boolean }>;
};

describe('manifest parity with the API (shared fixture)', () => {
  it('reads the pinned copy', () => {
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(FIXTURE_SHA256);
  });

  it('sends exactly the top-level keys the API accepts', () => {
    expect([...MANIFEST_KEYS].sort()).toEqual(parity.manifest_keys);
  });

  it.each(parity.rows.map((row) => [row.name, row] as const))('maps %s to the manifest the API validates', (_name, row) => {
    expect(toManifest({ ...parity.base_toml, ...row.toml }).manifest).toEqual(row.manifest);
  });

  it.each(parity.origins.map((row) => [row.url, row.shares] as const))('answers the Queek-origin guard like the API for %s', (url, shares) => {
    expect(sharesKnownQueekOrigin(url)).toBe(shares);
  });

  it('checks only the structure of a private app', () => {
    const base = { ...parity.base_toml, distribution: 'private' };
    expect(() => toManifest({ ...base, store: 'acme' })).toThrow('The store must be the store p_id (a positive integer).');
    expect(() => toManifest({ ...base, store: 0 })).toThrow('The store must be the store p_id');
    expect(() => toManifest({ ...base, payment_provider: 'custom' })).toThrow('The payment_provider section must be a table.');
    expect(() => toManifest({ ...parity.base_toml, distribution: 'secret' })).toThrow('The distribution must be one of: public, development, private.');
  });
});
