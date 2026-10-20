import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeveloperApi, reviewAdditionsLine, reviewAdditionsOf, type FetchImpl } from '../src/lib/app-api.js';

let session: { api: DeveloperApi } | null = null;
vi.mock('../src/lib/app-command.js', async (original) => ({
  ...(await original<typeof import('../src/lib/app-command.js')>()),
  appSession: async () => session,
}));

const { default: AppRelease } = await import('../src/commands/app/release.js');
const { default: AppDeploy } = await import('../src/commands/app/deploy.js');

const dirs: string[] = [];
afterEach(() => {
  session = null;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const TOML = `
slug = "hello"
name = "Hello World"

[access]
scopes = ["merchant-business_profile-read"]

[app]
install_url = "https://hello.example.com/install"
uninstall_url = "https://hello.example.com/uninstall"
`;

const label = (text: unknown): { facet: string; label: unknown } => ({ facet: 'scope:x', label: text });
const gated = (extra: Record<string, unknown>): [number, unknown] => [
  409,
  { status: 'failed', error_type: 'review_required', message: 'Submit this version.', data: { version: '1.0.0', sequence: 1, submission_url: null, ...extra } },
];
/** The release answer is flat; the deploy answer nests the version row. */
const inReview = (extra: Record<string, unknown>, deploy = false): [number, unknown] => [
  202,
  {
    status: 'success',
    message: 'ok',
    data: deploy
      ? { status: 'in_review', p_id: 'app_1', slug: 'hello', name: 'Hello', version: { version: '1.1.0', sequence: 3, review_status: 'in_review' }, ...extra }
      : { status: 'in_review', version: '1.1.0', sequence: 3, ...extra },
  },
];

/** Run a command against a canned API answer; returns what it printed. */
async function printed(command: 'release' | 'deploy', answer: [number, unknown]): Promise<string[]> {
  const fetchImpl: FetchImpl = vi.fn(async () => ({ ok: answer[0] < 300, status: answer[0], json: async () => answer[1] }) as Response);
  session = { api: new DeveloperApi('https://api.test', { fetchImpl, getAuth: async () => ({ token: 't', kind: 'user' as const }) }) };
  const lines: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), 'review-additions-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'queek.app.toml'), TOML);
  const instance = Object.create((command === 'release' ? AppRelease : AppDeploy).prototype) as Record<string, unknown>;
  instance.parse = async () => (command === 'release' ? { args: { app: 'hello', version: '1' }, flags: {} } : { args: {}, flags: { path: dir } });
  instance.setVerbose = () => undefined;
  instance.debug = () => undefined;
  instance.logToStderr = () => undefined;
  instance.log = (line: string) => lines.push(line);
  instance.error = (message: string) => {
    throw new Error(message);
  };
  await (instance as { run: () => Promise<unknown> }).run();
  return lines;
}

const READY = 'v1.0.0 is ready for review. Run: queek app submit hello --sequence 1';
const TRACK = 'Track it on the Developer page: https://dashboard.usequeek.com/developers';

describe('reviewAdditionsLine', () => {
  it('names the labels, comma separated', () => {
    expect(reviewAdditionsLine(['the `merchant-customers-contact-read` scope', 'a storefront block'])).toBe(
      'It adds: the `merchant-customers-contact-read` scope, a storefront block',
    );
  });

  it('is null for nothing to name', () => {
    expect(reviewAdditionsLine(undefined)).toBeNull();
    expect(reviewAdditionsLine([])).toBeNull();
  });

  it('caps at five labels, then says how many more', () => {
    expect(reviewAdditionsLine(['a', 'b', 'c', 'd', 'e'])).toBe('It adds: a, b, c, d, e');
    expect(reviewAdditionsLine(['a', 'b', 'c', 'd', 'e', 'f'])).toBe('It adds: a, b, c, d, e and 1 more');
    expect(reviewAdditionsLine(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'])).toBe('It adds: a, b, c, d, e and 3 more');
  });
});

describe('reviewAdditionsOf (untrusted server text)', () => {
  it('keeps string labels in order', () => {
    expect(reviewAdditionsOf({ review_additions: [label('one'), label('two')] })).toEqual(['one', 'two']);
  });

  it('is empty when absent, empty or not a list', () => {
    expect(reviewAdditionsOf({})).toEqual([]);
    expect(reviewAdditionsOf(null)).toEqual([]);
    expect(reviewAdditionsOf({ review_additions: [] })).toEqual([]);
    expect(reviewAdditionsOf({ review_additions: 'a scope' })).toEqual([]);
    expect(reviewAdditionsOf({ review_additions: { label: 'a scope' } })).toEqual([]);
  });

  it('drops malformed entries and never prints a non-string label', () => {
    const rows = [null, 'bare string', 7, [], {}, label(5), label(null), label({ nested: 'x' }), label(['x']), label(''), label('   '), label('\n\t'), label('kept')];
    expect(reviewAdditionsOf({ review_additions: rows })).toEqual(['kept']);
  });

  it('strips control characters, escapes and line breaks', () => {
    expect(reviewAdditionsOf({ review_additions: [label('the \u001B[31mred\u001B[0m scope'), label('two\nlines\r\nhere'), label('nul\u0000byte\u007F'), label('‮reversed⁦')] })).toEqual([
      'the [31mred [0m scope',
      'two lines here',
      'nul byte',
      'reversed',
    ]);
  });
});

describe('the API keeps the result byte for byte unless the server names additions', () => {
  const api = (answer: [number, unknown]): DeveloperApi =>
    new DeveloperApi('https://api.test', {
      fetchImpl: vi.fn(async () => ({ ok: answer[0] < 300, status: answer[0], json: async () => answer[1] }) as Response),
      getAuth: async () => ({ token: 't', kind: 'user' as const }),
    });

  it('release and the 409 gate carry review_additions only when non-empty', async () => {
    expect(await api(inReview({})).releaseVersion('hello', '3')).toEqual({ status: 'in_review', version: '1.1.0', sequence: 3 });
    expect(await api(inReview({ review_additions: [] })).releaseVersion('hello', '3')).toEqual({ status: 'in_review', version: '1.1.0', sequence: 3 });
    expect(await api(inReview({ review_additions: [label('a scope')] })).releaseVersion('hello', '3')).toEqual({
      status: 'in_review',
      version: '1.1.0',
      sequence: 3,
      review_additions: ['a scope'],
    });
    expect(await api(gated({})).releaseVersion('hello', '1')).toEqual({ status: 'review_required', version: '1.0.0', sequence: 1, submission_url: null });
    expect(await api(gated({ review_additions: [label('a scope')] })).releaseVersion('hello', '1')).toMatchObject({ review_additions: ['a scope'] });
  });
});

describe.each(['release', 'deploy'] as const)('queek app %s prints what the version adds', (command) => {
  it('prints it after the ready-for-review line, before the track line', async () => {
    const lines = await printed(command, gated({ review_additions: [label('the `merchant-customers-contact-read` scope'), label('a storefront block')] }));
    expect(lines).toEqual([READY, 'It adds: the `merchant-customers-contact-read` scope, a storefront block', TRACK]);
  });

  it('prints nothing extra when the field is absent, empty or entirely malformed', async () => {
    expect(await printed(command, gated({}))).toEqual([READY, TRACK]);
    expect(await printed(command, gated({ review_additions: [] }))).toEqual([READY, TRACK]);
    expect(await printed(command, gated({ review_additions: [label(5), null, 'x', {}] }))).toEqual([READY, TRACK]);
    expect(await printed(command, gated({ review_additions: 'x' }))).toEqual([READY, TRACK]);
  });

  it('caps at five labels', async () => {
    const lines = await printed(command, gated({ review_additions: ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(label) }));
    expect(lines[1]).toBe('It adds: a, b, c, d, e and 2 more');
  });

  it('strips control characters from labels', async () => {
    const lines = await printed(command, gated({ review_additions: [label('bad\u001B[2Jscope\n')] }));
    expect(lines[1]).toBe('It adds: bad [2Jscope');
    expect([...lines[1]].some((character) => character.charCodeAt(0) < 0x20)).toBe(false);
  });

  it('names the additions on an in_review answer too, and stays unchanged without them', async () => {
    const SUBMITTED = 'Version 1.1.0 submitted for review — it releases when approved.';
    const deploy = command === 'deploy';
    expect(await printed(command, inReview({ review_additions: [label('a scope')] }, deploy))).toEqual([SUBMITTED, 'It adds: a scope']);
    expect(await printed(command, inReview({}, deploy))).toEqual([SUBMITTED]);
  });
});
