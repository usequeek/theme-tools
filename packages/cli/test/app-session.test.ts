import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeveloperApi, type FetchImpl } from '../src/lib/app-api.js';
import { deviceLogin, type DeviceClock } from '../src/lib/app-session.js';

const originals = { ...process.env };

afterEach(() => {
  process.env = { ...originals };
});

function isolatedHome(): void {
  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), 'queek-home-'));
  delete process.env.QUEEK_APP_AUTOMATION_TOKEN;
}

const PAIR = { access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'developer-cli', token_type: 'Bearer' };
const CODE = { device_code: 'd', user_code: 'ABCD-1234', verification_uri: 'https://dash/activate', expires_in: 600, interval: 5 };

/** A fake clock: sleeps are recorded, time only moves when told. */
function fakeClock(): { clock: DeviceClock; sleeps: number[]; advance: (ms: number) => void } {
  let now = 1_000_000;
  const sleeps: number[] = [];
  return {
    clock: { now: () => now, sleep: async (ms: number) => { sleeps.push(ms); } },
    sleeps,
    advance: (ms: number) => { now += ms; },
  };
}

function apiFor(statuses: Array<[number, unknown]>): { api: DeveloperApi; calls: number } {
  let calls = 0;
  const fetchImpl: FetchImpl = vi.fn(async (url: string) => {
    if (url.includes('/oauth/device/code')) {
      return { ok: true, status: 200, json: async () => CODE } as Response;
    }
    calls += 1;
    const [status, body] = statuses[Math.min(calls - 1, statuses.length - 1)];
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  return { api: new DeveloperApi('https://api.test', { fetchImpl }), calls };
}

const io = { log: () => {}, logError: () => {}, debug: () => {} };

describe('deviceLogin backoff (B1: slow_down/429 never throw)', () => {
  it('widens the poll by 5s per slow_down and still logs in', async () => {
    isolatedHome();
    const { api } = apiFor([
      [400, { error: 'slow_down', error_description: 'Polling too fast; slow down.' }],
      [429, { status: 'failed', message: 'Too Many Attempts.' }],
      [200, PAIR],
    ]);
    const { clock, sleeps } = fakeClock();
    expect(await deviceLogin(api, io, clock)).toBe('file');
    // interval 5 → 5s, then +5s per slow_down: 5000, 10000, 15000.
    expect(sleeps).toEqual([5000, 10000, 15000]);
  });

  it('keeps waiting through slow_down until expiry, then reports expiry (not slow_down)', async () => {
    isolatedHome();
    const { api } = apiFor([[400, { error: 'slow_down', error_description: 'Polling too fast; slow down.' }]]);
    const { clock, advance } = fakeClock();
    const run = deviceLogin(api, io, { ...clock, sleep: async (ms: number) => { advance(ms); } });
    await expect(run).rejects.toThrow('The code expired before approval — run the login again for a fresh one.');
  });
});
