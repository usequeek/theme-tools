import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  atomicWriteFile,
  CodegenError,
  errorExitCode,
  generateMerchantTypes,
  isHtmlContentType,
  looksLikeHtml,
  MERCHANT_API_BASE,
  MERCHANT_SPEC_URL,
  normalizeSpec,
  offlineStderr,
  parseSpecText,
  provenanceHeader,
  recordedSpecHash,
  runCodegen,
  sanityCheckSpec,
  specSha256,
  warnLine,
  type SpecResponse,
} from '../src/lib/app-codegen.js';
import AppCodegen, { codegenOkLine } from '../src/commands/app/codegen.js';
import { TomlError } from '../src/lib/app-manifest.js';

const TOML = `
slug = "hello"
name = "Hello World"

[access]
scopes = ["merchant-business_profile-read"]

[app]
install_url = "https://hello.example.com/install"
uninstall_url = "https://hello.example.com/uninstall"
`;

const specObject = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  openapi: '3.1.0',
  info: { title: 'Merchant', version: 'v1' },
  servers: [{ url: 'http://localhost:8000', description: 'Local' }],
  paths: {
    '/orders/import': { post: { operationId: 'importOrder', responses: { 200: { description: 'ok' } } } },
    '/orders': { get: { operationId: 'listOrders', responses: { 200: { description: 'ok' } } } },
  },
  ...overrides,
});

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function stageApp(extra: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'app-codegen-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'queek.app.toml'), TOML);
  for (const [name, content] of Object.entries(extra)) writeFileSync(join(dir, name), content);
  return dir;
}

function fakeFetch(text: string, init: { ok?: boolean; status?: number; contentType?: string } = {}): () => Promise<SpecResponse> {
  return async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? (init.contentType ?? 'application/json') : null) },
    text: async () => text,
  });
}

const CANNED_TS = 'export interface paths { "/orders/import": unknown }\n';
const fakeGenerate = async () => CANNED_TS;
const FIXED_NOW = () => new Date('2026-09-30T00:00:00.000Z');

describe('sanityCheckSpec (SDK gen-merchant-types.mjs:46-51)', () => {
  it('accepts OpenAPI 3.1.0 with /orders/import', () => {
    expect(() => sanityCheckSpec(specObject())).not.toThrow();
  });

  it('refuses a wrong OpenAPI version, missing paths, an explicit null paths, and a missing import op', () => {
    expect(() => sanityCheckSpec(specObject({ openapi: '3.0.0' }))).toThrow('Spec sanity check failed');
    expect(() => sanityCheckSpec({ openapi: '3.1.0' })).toThrow('Spec sanity check failed');
    expect(() => sanityCheckSpec(specObject({ paths: null }))).toThrow('Spec sanity check failed');
    expect(() => sanityCheckSpec(specObject({ paths: { '/orders': {} } }))).toThrow('/orders/import');
  });
});

describe('HTML refusal (Cloudflare error page)', () => {
  it('sniffs bodies and content types', () => {
    expect(looksLikeHtml('<html><body>502</body></html>')).toBe(true);
    expect(looksLikeHtml('  <!DOCTYPE html>')).toBe(true);
    expect(looksLikeHtml('{"openapi": "3.1.0"}')).toBe(false);
    expect(looksLikeHtml('')).toBe(false);
    expect(isHtmlContentType('text/html; charset=utf-8')).toBe(true);
    expect(isHtmlContentType('application/json')).toBe(false);
    expect(isHtmlContentType(null)).toBe(false);
  });

  it('parseSpecText refuses HTML loudly instead of a bare SyntaxError', () => {
    expect(() => parseSpecText('<html>nope</html>', 'live')).toThrow('Refused HTML');
    expect(() => parseSpecText('not json {', 'live')).toThrow('did not parse as JSON');
    expect(parseSpecText('{"openapi":"3.1.0"}', 'live')).toEqual({ openapi: '3.1.0' });
  });

  it('catches BOM-prefixed HTML too (an edge may prepend U+FEFF)', () => {
    expect(looksLikeHtml('﻿<html>502</html>')).toBe(true);
    expect(() => parseSpecText('﻿<html>502</html>', 'live')).toThrow('Refused HTML');
  });
});

describe('hash + normalize (SDK gen-merchant-types.mjs:55)', () => {
  it('hashes the exact bytes and normalizes only servers', () => {
    const text = JSON.stringify(specObject());
    expect(specSha256(text)).toBe(createHash('sha256').update(text, 'utf8').digest('hex'));
    const normalized = normalizeSpec(specObject());
    expect(normalized.servers).toEqual([{ url: MERCHANT_API_BASE, description: 'Current' }]);
    expect(normalized.paths).toEqual(specObject().paths);
  });
});

describe('runCodegen with fakes', () => {
  it('fetches the live spec by default and writes types + the hash record', async () => {
    const dir = stageApp();
    const text = JSON.stringify(specObject());
    const result = await runCodegen({ appDir: dir, fetchFn: fakeFetch(text), generateFn: fakeGenerate, now: FIXED_NOW });
    expect(result.offline).toBe(false);
    if (result.offline) return;
    expect(result.source).toBe(MERCHANT_SPEC_URL);
    expect(result.specSha256).toBe(specSha256(text));
    expect(result.paths).toBe(2);
    const written = readFileSync(join(dir, 'types', 'merchant.ts'), 'utf8');
    expect(written).toContain('GENERATED by `queek app codegen`');
    expect(written).toContain(result.specSha256);
    expect(written).toContain(CANNED_TS);
    const record = JSON.parse(readFileSync(join(dir, '.queek', 'codegen.json'), 'utf8'));
    expect(record).toEqual({
      source: MERCHANT_SPEC_URL,
      specSha256: specSha256(text),
      specVersion: 'v1',
      generatedAt: '2026-09-30T00:00:00.000Z',
      paths: 2,
    });
  });

  it('reads an explicit file offline (no fetch), hashing the file bytes', async () => {
    const text = JSON.stringify(specObject());
    const dir = stageApp({ 'merchant.json': text });
    let fetched = false;
    const result = await runCodegen({
      appDir: dir,
      source: 'merchant.json',
      fetchFn: async () => {
        fetched = true;
        throw new Error('must not fetch');
      },
      generateFn: fakeGenerate,
      now: FIXED_NOW,
    });
    expect(fetched).toBe(false);
    expect(result.offline).toBe(false);
    if (result.offline) return;
    expect(result.source).toBe('merchant.json');
    expect(readFileSync(join(dir, '.queek', 'codegen.json'), 'utf8')).toContain(specSha256(text));
  });

  it('records the backend x-queek-spec-sha hash when the spec carries it', async () => {
    const withHash = JSON.stringify(specObject({ info: { title: 'Merchant', version: 'v1', 'x-queek-spec-sha': 'abc123' } }));
    const dir = stageApp();
    await runCodegen({ appDir: dir, fetchFn: fakeFetch(withHash), generateFn: fakeGenerate, now: FIXED_NOW });
    expect(JSON.parse(readFileSync(join(dir, '.queek', 'codegen.json'), 'utf8')).serverSpecSha256).toBe('abc123');
  });

  it('network failure on the live URL keeps existing types and reports offline (exit 0 downstream)', async () => {
    const dir = stageApp();
    mkdirSync(join(dir, 'types'), { recursive: true });
    writeFileSync(join(dir, 'types', 'merchant.ts'), '// old\n');
    const result = await runCodegen({
      appDir: dir,
      fetchFn: async () => {
        throw new Error('fetch failed');
      },
      generateFn: fakeGenerate,
    });
    expect(result.offline).toBe(true);
    if (!result.offline) return;
    expect(result.reason).toContain('could not fetch');
    expect(readFileSync(join(dir, 'types', 'merchant.ts'), 'utf8')).toBe('// old\n');
    expect(existsSync(join(dir, '.queek', 'codegen.json'))).toBe(false);
  });

  it('an HTML error page on the live URL keeps types (warn path), but an explicit source is refused', async () => {
    const dir = stageApp();
    const kept = await runCodegen({ appDir: dir, fetchFn: fakeFetch('<html>502</html>'), generateFn: fakeGenerate });
    expect(kept.offline).toBe(true);

    await expect(runCodegen({ appDir: dir, source: MERCHANT_SPEC_URL, fetchFn: fakeFetch('<html>502</html>'), generateFn: fakeGenerate })).rejects.toThrow(
      'Refused HTML',
    );
    await expect(
      runCodegen({ appDir: dir, source: MERCHANT_SPEC_URL, fetchFn: fakeFetch('<html>502</html>', { contentType: 'text/html' }), generateFn: fakeGenerate }),
    ).rejects.toThrow('Refused HTML');
  });

  it('a contract-broken live spec keeps types (warn path), but an explicit file is refused', async () => {
    const dir = stageApp();
    const broken = JSON.stringify(specObject({ paths: { '/orders': {} } }));
    const kept = await runCodegen({ appDir: dir, fetchFn: fakeFetch(broken), generateFn: fakeGenerate });
    expect(kept.offline).toBe(true);
    if (!kept.offline) return;
    expect(kept.reason).toContain('Spec sanity check failed');

    const fileDir = stageApp({ 'broken.json': broken });
    await expect(runCodegen({ appDir: fileDir, source: 'broken.json', generateFn: fakeGenerate })).rejects.toThrow('Spec sanity check failed');
  });

  it('HTTP 500 on the live URL keeps types, but on an explicit URL it throws', async () => {
    const dir = stageApp();
    const kept = await runCodegen({ appDir: dir, fetchFn: fakeFetch('err', { ok: false, status: 500 }), generateFn: fakeGenerate });
    expect(kept.offline).toBe(true);
    await expect(
      runCodegen({ appDir: dir, source: 'https://example.com/spec.json', fetchFn: fakeFetch('err', { ok: false, status: 500 }), generateFn: fakeGenerate }),
    ).rejects.toThrow('Could not fetch Merchant API spec: 500');
  });

  it('a missing explicit file is a usage error (exit 2), and a non-app dir is refused', async () => {
    const dir = stageApp();
    const missing = await runCodegen({ appDir: dir, source: 'no-such.json', generateFn: fakeGenerate }).catch((error: Error) => error);
    expect(missing).toBeInstanceOf(CodegenError);
    expect((missing as CodegenError).exitCode).toBe(2);

    const bare = mkdtempSync(join(tmpdir(), 'app-codegen-bare-'));
    dirs.push(bare);
    await expect(runCodegen({ appDir: bare, fetchFn: fakeFetch('{}'), generateFn: fakeGenerate })).rejects.toThrow('queek.app.toml');
  });

  it('a failing generator is reported, writing nothing', async () => {
    const dir = stageApp();
    await expect(
      runCodegen({ appDir: dir, fetchFn: fakeFetch(JSON.stringify(specObject())), generateFn: async () => { throw new Error('boom'); } }),
    ).rejects.toThrow('openapi-typescript failed: boom');
    expect(existsSync(join(dir, 'types', 'merchant.ts'))).toBe(false);
  });
});

describe('specSha256 vs serverSpecSha256 (live-proven distinct)', () => {
  it('the content hash drives the pin while the backend hash rides along; the two never match', async () => {
    // The served bytes embed x-queek-spec-sha, so hashing them can never
    // reproduce the backend hash — the record keeps both, the header pins
    // the content hash, and the rerun skips on it.
    const serverHash = '4'.repeat(64);
    const text = JSON.stringify(specObject({ info: { title: 'Merchant', version: 'v1', 'x-queek-spec-sha': serverHash } }));
    const dir = stageApp();
    let calls = 0;
    const counting = async (): Promise<string> => {
      calls += 1;
      return CANNED_TS;
    };
    const first = await runCodegen({ appDir: dir, fetchFn: fakeFetch(text), generateFn: counting, now: FIXED_NOW });
    expect(first.offline).toBe(false);
    if (first.offline) return;
    expect(first.unchanged).toBe(false);
    const record = JSON.parse(readFileSync(join(dir, '.queek', 'codegen.json'), 'utf8'));
    expect(record.specSha256).toBe(specSha256(text));
    expect(record.serverSpecSha256).toBe(serverHash);
    expect(record.specSha256).not.toBe(record.serverSpecSha256);
    const header = readFileSync(join(dir, 'types', 'merchant.ts'), 'utf8');
    expect(header).toContain(`Spec sha256: ${record.specSha256}`);
    expect(header).not.toContain(serverHash);
    expect(recordedSpecHash(dir)).toBe(record.specSha256);

    const second = await runCodegen({ appDir: dir, fetchFn: fakeFetch(text), generateFn: counting, now: FIXED_NOW });
    expect(second.offline).toBe(false);
    if (second.offline) return;
    expect(second.unchanged).toBe(true);
    expect(calls).toBe(1);
  });
});

describe('recordedSpecHash (MUST-1: the header is the pin, the JSON a debug aid)', () => {
  it('is null with neither record nor types, and reads the record first', async () => {
    const dir = stageApp();
    expect(recordedSpecHash(dir)).toBeNull();
    const text = JSON.stringify(specObject());
    await runCodegen({ appDir: dir, fetchFn: fakeFetch(text), generateFn: fakeGenerate, now: FIXED_NOW });
    expect(recordedSpecHash(dir)).toBe(specSha256(text));
  });

  it('falls back to the committed header once .queek/ is gone (fresh clone)', async () => {
    const dir = stageApp();
    const text = JSON.stringify(specObject());
    await runCodegen({ appDir: dir, fetchFn: fakeFetch(text), generateFn: fakeGenerate, now: FIXED_NOW });
    rmSync(join(dir, '.queek'), { recursive: true, force: true });
    expect(recordedSpecHash(dir)).toBe(specSha256(text));
  });

  it('ignores a corrupt record and a malformed hash, using the header instead', async () => {
    const dir = stageApp();
    const text = JSON.stringify(specObject());
    await runCodegen({ appDir: dir, fetchFn: fakeFetch(text), generateFn: fakeGenerate, now: FIXED_NOW });
    writeFileSync(join(dir, '.queek', 'codegen.json'), 'not json {');
    expect(recordedSpecHash(dir)).toBe(specSha256(text));
    writeFileSync(join(dir, '.queek', 'codegen.json'), JSON.stringify({ specSha256: 'bogus' }));
    expect(recordedSpecHash(dir)).toBe(specSha256(text));
  });
});

describe('skip-when-unchanged (reruns leave the tree clean)', () => {
  it('rewrites nothing on a rerun: same bytes, stale generatedAt, generator idle', async () => {
    const dir = stageApp();
    const text = JSON.stringify(specObject());
    let calls = 0;
    const counting = async (): Promise<string> => {
      calls += 1;
      return CANNED_TS;
    };
    const first = await runCodegen({ appDir: dir, fetchFn: fakeFetch(text), generateFn: counting, now: FIXED_NOW });
    expect(first.offline).toBe(false);
    if (first.offline) return;
    expect(first.unchanged).toBe(false);
    const typesBefore = readFileSync(join(dir, 'types', 'merchant.ts'), 'utf8');

    const second = await runCodegen({
      appDir: dir,
      fetchFn: fakeFetch(text),
      generateFn: counting,
      now: () => new Date('2027-01-01T00:00:00.000Z'),
    });
    expect(second.offline).toBe(false);
    if (second.offline) return;
    expect(second.unchanged).toBe(true);
    expect(calls).toBe(1);
    expect(readFileSync(join(dir, 'types', 'merchant.ts'), 'utf8')).toBe(typesBefore);
    expect(JSON.parse(readFileSync(join(dir, '.queek', 'codegen.json'), 'utf8')).generatedAt).toBe('2026-09-30T00:00:00.000Z');
  });

  it('regenerates when the types file is gone even though the record matches', async () => {
    const dir = stageApp();
    const text = JSON.stringify(specObject());
    await runCodegen({ appDir: dir, fetchFn: fakeFetch(text), generateFn: fakeGenerate, now: FIXED_NOW });
    rmSync(join(dir, 'types', 'merchant.ts'));
    const rerun = await runCodegen({ appDir: dir, fetchFn: fakeFetch(text), generateFn: fakeGenerate, now: FIXED_NOW });
    expect(rerun.offline).toBe(false);
    if (rerun.offline) return;
    expect(rerun.unchanged).toBe(false);
    expect(existsSync(join(dir, 'types', 'merchant.ts'))).toBe(true);
  });
});

describe('atomicWriteFile (crash-safe pair of writes)', () => {
  it('writes the content and leaves no temp file behind', () => {
    const dir = stageApp();
    mkdirSync(join(dir, 'types'), { recursive: true });
    atomicWriteFile(join(dir, 'types', 'merchant.ts'), 'one');
    atomicWriteFile(join(dir, 'types', 'merchant.ts'), 'two');
    expect(readFileSync(join(dir, 'types', 'merchant.ts'), 'utf8')).toBe('two');
    const leftovers = (names: string[]): string[] => names.filter((name) => name.endsWith('.tmp'));
    expect(leftovers(readdirSync(join(dir, 'types')))).toEqual([]);
    expect(leftovers(readdirSync(dir))).toEqual([]);
  });

  it('a full run leaves no temp files in types/ or .queek/', async () => {
    const dir = stageApp();
    await runCodegen({ appDir: dir, fetchFn: fakeFetch(JSON.stringify(specObject())), generateFn: fakeGenerate, now: FIXED_NOW });
    const leftovers = (names: string[]): string[] => names.filter((name) => name.endsWith('.tmp'));
    expect(leftovers(readdirSync(join(dir, 'types')))).toEqual([]);
    expect(leftovers(readdirSync(join(dir, '.queek')))).toEqual([]);
  });

  it('sweeps a stale <file>.<pid>.tmp leftover from a crashed run, keeping anything else', () => {
    const dir = stageApp();
    mkdirSync(join(dir, 'types'), { recursive: true });
    const target = join(dir, 'types', 'merchant.ts');
    writeFileSync(`${target}.987654321.tmp`, 'crash leftover');
    writeFileSync(join(dir, 'types', 'other.ts.987654321.tmp'), 'another file’s tmp — not ours to sweep');
    writeFileSync(join(dir, 'types', 'notes.txt'), 'unrelated');
    atomicWriteFile(target, 'fresh');
    expect(readFileSync(target, 'utf8')).toBe('fresh');
    expect(existsSync(`${target}.987654321.tmp`)).toBe(false);
    expect(readFileSync(join(dir, 'types', 'other.ts.987654321.tmp'), 'utf8')).toBe('another file’s tmp — not ours to sweep');
    expect(readFileSync(join(dir, 'types', 'notes.txt'), 'utf8')).toBe('unrelated');
  });
});

describe('command mapping (offline→stderr, refusal→exit)', () => {
  it('offlineStderr pins the exact stderr line', () => {
    expect(offlineStderr({ offline: true, reason: 'kept' })).toBe('Warning: kept');
  });

  it('errorExitCode carries CodegenError/TomlError exits, defaulting to 1', () => {
    expect(errorExitCode(new CodegenError('refused', 2))).toBe(2);
    expect(errorExitCode(new CodegenError('nope'))).toBe(1);
    expect(errorExitCode(new TomlError('no toml here'))).toBe(2);
    expect(errorExitCode(new Error('boom'))).toBe(1);
    expect(errorExitCode('a string')).toBe(1);
  });

  it('codegenOkLine pins the exact stdout line for unchanged and fresh runs', () => {
    const hash = '1'.repeat(64);
    const file = join('types', 'merchant.ts');
    const recordFile = join('.queek', 'codegen.json');
    expect(
      codegenOkLine({ offline: false, unchanged: true, file, recordFile, source: MERCHANT_SPEC_URL, specSha256: hash, paths: 41 }),
    ).toBe(`types/merchant.ts is already current (spec ${'1'.repeat(12)}…) — nothing to do.`);
    expect(
      codegenOkLine({ offline: false, unchanged: false, file, recordFile, source: MERCHANT_SPEC_URL, specSha256: hash, paths: 41 }),
    ).toBe(`Wrote ${file} (41 paths, spec ${'1'.repeat(12)}…) — hash recorded in ${recordFile}.`);
  });

  it('the command description names the committed header as the pin', () => {
    expect(AppCodegen.description).toContain('Spec sha256:');
    expect(AppCodegen.description).toContain('.queek/codegen.json');
  });
});

describe('generator pin coupling (SDK bumps must propagate here)', () => {
  it('runs the exact openapi-typescript declared in package.json', () => {
    const require = createRequire(import.meta.url);
    const cli = require('../package.json') as { dependencies: Record<string, string> };
    const installed = require('openapi-typescript/package.json') as { version: string };
    expect(cli.dependencies['openapi-typescript']).toBe('7.13.0');
    expect(installed.version).toBe(cli.dependencies['openapi-typescript']);
  });
});

describe('warnLine (check-merchant-snapshot.mjs annotation shape)', () => {
  it('emits a CI annotation under GITHUB_ACTIONS, plain text locally', () => {
    const previous = process.env.GITHUB_ACTIONS;
    process.env.GITHUB_ACTIONS = 'true';
    expect(warnLine('kept')).toBe('::warning::kept');
    if (previous === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = previous;
    expect(warnLine('kept')).toBe('Warning: kept');
  });
});

describe('generateMerchantTypes (real openapi-typescript, no fake)', () => {
  it('turns the normalized spec into a paths-typed module', async () => {
    const ts = await generateMerchantTypes(normalizeSpec(specObject()));
    expect(ts).toContain('"/orders/import"');
    expect(provenanceHeader('src', 'hash')).toContain('GENERATED by `queek app codegen`');
  });
});
