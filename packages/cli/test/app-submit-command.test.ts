import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeveloperApi, type FetchImpl } from '../src/lib/app-api.js';

// `queek app submit` as a command (the pure helpers are in app-submit.test.ts): what it returns for --json, the exit code
// it leaves, and which requests it makes — a taken review slot must never reach the submit route.
let session: { api: DeveloperApi; kind: 'user' | 'automation' } | null = null;
vi.mock('../src/lib/app-command.js', async (original) => ({
  ...(await original<typeof import('../src/lib/app-command.js')>()),
  appSession: async () => session,
}));

const { default: AppSubmit } = await import('../src/commands/app/submit.js');

const BASE = '/api/v1/biz/vendor/developer/apps/booking';
const ok = (data: unknown): [number, unknown] => [200, { status: 'success', message: 'ok', data }];
const versions = (rows: Array<[number, string]>): [number, unknown] =>
  ok(rows.map(([sequence, review_status]) => ({ version: `1.1.${sequence}`, sequence, review_status, review_note: null, changelog: null, is_current: false, created_at: null })));
const checklist = (sequence: number, failing = false): [number, unknown] =>
  ok({ version: `1.1.${sequence}`, sequence, review_status: 'development', checks: [{ key: 'tested', level: 'error', ok: !failing, detail: null, at: '', label: 'Installed on a dev store' }] });

afterEach(() => {
  session = null;
  process.exitCode = undefined;
});

/** Run submit with canned routes; returns its --json result, what it wrote, the requests and the exit code it left. */
async function submit(flags: Record<string, unknown>, routes: Record<string, [number, unknown]>, kind: 'user' | 'automation' = 'user') {
  const calls: string[] = [];
  const fetchImpl: FetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url.replace('https://api.test', '')}`;
    calls.push(key);
    const [status, body] = routes[key] ?? [500, { message: `no mock for ${key}` }];
    return { ok: status < 300, status, json: async () => body } as Response;
  });
  session = { api: new DeveloperApi('https://api.test', { fetchImpl, getAuth: async () => ({ token: 't', kind }) }), kind };
  const out: string[] = [];
  const instance = Object.create(AppSubmit.prototype) as Record<string, unknown>;
  instance.parse = async () => ({ args: { app: 'booking' }, flags: { 'check-only': false, refresh: false, attest: false, ...flags } });
  instance.setVerbose = () => undefined;
  instance.debug = () => undefined;
  instance.log = (line: string) => out.push(line);
  instance.logToStderr = (line: string) => out.push(`stderr: ${line}`);
  instance.error = (message: string, options?: { exit?: number }) => {
    throw Object.assign(new Error(message), { exit: options?.exit });
  };
  const result = await (instance as { run: () => Promise<Record<string, unknown>> }).run();
  return { result, out, calls, exitCode: process.exitCode };
}

describe('queek app submit (command)', () => {
  it('another version in review: submits nothing, exit 1, submitted:false + reason + blocking — the submit route is never called', async () => {
    const run = await submit({ sequence: 22 }, { [`GET ${BASE}/versions`]: versions([[23, 'in_review'], [22, 'development']]) });
    expect(run.result).toEqual({
      app: 'booking', version: '1.1.22', sequence: 22, submitted: false, reason: 'other_version_in_review', blocking: [{ version: '1.1.23', sequence: 23 }],
    });
    expect(run.exitCode).toBe(1);
    expect(run.calls).toEqual([`GET ${BASE}/versions`]);
    expect(run.out.join('\n')).toContain('queek app withdraw booking --sequence 23 --yes');
  });

  it('the target itself in review: submitted:false, already_in_review, exit 0', async () => {
    const run = await submit({}, { [`GET ${BASE}/versions`]: versions([[23, 'in_review'], [22, 'development']]) });
    expect(run.result).toMatchObject({ sequence: 23, submitted: false, reason: 'already_in_review' });
    expect(run.exitCode).toBeUndefined();
    expect(run.calls).toEqual([`GET ${BASE}/versions`]);
  });

  it('a 409 after the POST (another submit won the slot) names the version that holds it, exit 1', async () => {
    let read = 0;
    const routes: Record<string, [number, unknown]> = {
      [`GET ${BASE}/versions/22/submission`]: checklist(22),
      [`POST ${BASE}/versions/22/submit`]: [409, { status: 'failed', message: 'This app already has a version submitted for review.', error_type: 'already_submitted', data: null }],
    };
    Object.defineProperty(routes, `GET ${BASE}/versions`, {
      enumerable: true,
      get: () => (read++ === 0 ? versions([[22, 'development']]) : versions([[23, 'in_review'], [22, 'development']])),
    });
    const dir = mkdtempSync(join(tmpdir(), 'submit-race-'));
    const file = join(dir, 'review.md');
    writeFileSync(file, 'Install on the dev store and open the booking page.');
    try {
      const run = await submit({ sequence: 22, 'test-instructions-file': file, 'screencast-url': 'https://example.com/v', 'contact-email': 'a@b.co', 'emergency-email': 'c@d.co' }, routes);
      expect(run.calls).toContain(`POST ${BASE}/versions/22/submit`);
      expect(run.result).toMatchObject({ submitted: false, reason: 'other_version_in_review', blocking: [{ version: '1.1.23', sequence: 23 }] });
      expect(run.exitCode).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('--check-only: prints the checklist, submits nothing, exit 1 when a check fails or the slot is taken', async () => {
    const failing = await submit({ sequence: 22, 'check-only': true }, {
      [`GET ${BASE}/versions`]: versions([[22, 'development']]),
      [`GET ${BASE}/versions/22/submission`]: checklist(22, true),
    });
    expect(failing.result).toMatchObject({ submitted: false, reason: 'check_only', ready: false });
    expect(failing.exitCode).toBe(1);
    expect(failing.calls.some((call) => call.includes('/submit'))).toBe(false);

    process.exitCode = undefined;
    const blocked = await submit({ sequence: 22, 'check-only': true }, {
      [`GET ${BASE}/versions`]: versions([[23, 'in_review'], [22, 'development']]),
      [`GET ${BASE}/versions/22/submission`]: checklist(22),
    });
    expect(blocked.result).toMatchObject({ ready: false, blocking: [{ version: '1.1.23', sequence: 23 }] });
    expect(blocked.exitCode).toBe(1);

    process.exitCode = undefined;
    const inReview = await submit({ 'check-only': true }, {
      [`GET ${BASE}/versions`]: versions([[23, 'in_review']]),
      [`GET ${BASE}/versions/23/submission`]: checklist(23),
    });
    expect(inReview.result).toMatchObject({ ready: false });
    expect(inReview.out.join('\n')).toContain('already in review');

    process.exitCode = undefined;
    const ready = await submit({ sequence: 22, 'check-only': true, refresh: true }, {
      [`GET ${BASE}/versions`]: versions([[22, 'development']]),
      [`POST ${BASE}/versions/22/submission`]: checklist(22),
    });
    expect(ready.result).toMatchObject({ ready: true });
    expect(ready.exitCode).toBeUndefined();
    expect(ready.calls).toContain(`POST ${BASE}/versions/22/submission`);
  });

  it('refuses --refresh under an automation token, and an unknown --sequence, before anything else', async () => {
    await expect(submit({ refresh: true }, {}, 'automation')).rejects.toMatchObject({ exit: 2 });
    await expect(submit({ sequence: 99 }, { [`GET ${BASE}/versions`]: versions([[22, 'development']]) })).rejects.toThrow('no version with sequence 99');
  });
});
