import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  AutomationTokenError,
  DeveloperApi,
  LoginNeededError,
  type AuthContext,
  type FetchImpl,
} from '../src/lib/app-api.js';

const MANIFEST = {
  slug: 'hello',
  name: 'Hello',
  scopes: ['merchant-business_profile-read'],
  install_url: 'https://hello.example.com/install',
  uninstall_url: 'https://hello.example.com/uninstall',
};

/** Envelope the backend wears: {status, message, data} (Controller.php:21). */
const ok = (data: unknown): [number, unknown] => [200, { status: 'success', message: 'ok', data }];
const fail = (status: number, error: string, errorType = 'error'): [number, unknown] => [
  status,
  { status: 'failed', error, message: error, error_type: errorType, data: null },
];

/** A canned fetch: method + path → [status, body]. */
function mockFetch(routes: Record<string, [number, unknown]>) {
  const calls: { method: string; url: string; headers: Record<string, string>; body: unknown }[] = [];
  const fetchImpl: FetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = url.replace('https://api.test', '');
    let parsedBody: unknown;
    if (typeof init?.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    }
    calls.push({ method, url, headers: (init?.headers ?? {}) as Record<string, string>, body: parsedBody });
    const [status, body] = routes[`${method} ${path}`] ?? [500, { message: 'no mock' }];
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  return { fetchImpl, calls };
}

const userAuth = (token = 'tok'): (() => Promise<AuthContext>) => async () => ({ token, kind: 'user' });
const autoAuth = (token = 'auto'): (() => Promise<AuthContext>) => async () => ({ token, kind: 'automation' });

describe('DeveloperApi vs the S1 build (mocked HTTP)', () => {
  it('deploys {manifest, changelog} and reads signing_secret from the envelope', async () => {
    const { fetchImpl, calls } = mockFetch({
      'POST /api/v1/biz/vendor/developer/apps': ok({
        p_id: 'app_1', slug: 'hello', name: 'Hello',
        version: { version: '1.0.1', sequence: 2, review_status: 'development' },
        signing_secret: 'whsec_once',
      }),
    });
    const api = new DeveloperApi('https://api.test', { fetchImpl, getAuth: userAuth() });
    const result = await api.deploy(MANIFEST, 'A change');
    expect(result.slug).toBe('hello');
    expect(result.sequence).toBe(2);
    expect(result.signing_secret).toBe('whsec_once');
    expect(calls[0].body).toEqual({ manifest: MANIFEST, changelog: 'A change' });
    expect(calls[0].headers.authorization).toBe('Bearer tok');
  });

  it('reads the device pair: issue shape, 202 pending, 200 token pair, 404 unknown', async () => {
    const issued = new DeveloperApi(
      'https://api.test',
      {
        fetchImpl: mockFetch({
          'POST /oauth/device/code': [200, { device_code: 'd', user_code: 'ABCD-1234', verification_uri: 'https://dash/activate', expires_in: 600, interval: 5 }],
        }).fetchImpl,
      },
    );
    const code = await issued.deviceCode();
    expect(code.user_code).toBe('ABCD-1234');
    expect(code.verification_uri).toBe('https://dash/activate');

    const pending = new DeveloperApi('https://api.test', {
      fetchImpl: mockFetch({ 'GET /oauth/device/status?code=d': [202, { status: 'pending', expires_in: 590 }] }).fetchImpl,
    });
    expect(await pending.deviceStatus('d')).toBeNull();

    const approved = new DeveloperApi('https://api.test', {
      fetchImpl: mockFetch({
        'GET /oauth/device/status?code=d': [200, { access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'developer-cli', token_type: 'Bearer' }],
      }).fetchImpl,
    });
    expect(await approved.deviceStatus('d')).toMatchObject({ access_token: 'a', refresh_token: 'r' });

    const unknown = new DeveloperApi('https://api.test', {
      fetchImpl: mockFetch({ 'GET /oauth/device/status?code=nope': [404, { error: 'invalid_request', error_description: 'The device code is invalid or expired.' }] }).fetchImpl,
    });
    await expect(unknown.deviceStatus('nope')).rejects.toMatchObject({ status: 404, message: 'The device code is invalid or expired.' });
  });

  it('exchanges the PKCE code with NO client_secret (public native client)', async () => {
    const { fetchImpl, calls } = mockFetch({
      'POST /oauth/token': [200, { access_token: 'a', refresh_token: 'r', expires_in: 3600, scope: 'developer-cli', token_type: 'Bearer' }],
    });
    const api = new DeveloperApi('https://api.test', { fetchImpl });
    expect(await api.oauthToken({ code: 'c', code_verifier: 'v', redirect_uri: 'http://127.0.0.1:9/callback' })).toMatchObject({ access_token: 'a' });
    const sent = new URLSearchParams(calls[0].body as unknown as string);
    expect(sent.get('client_id')).toBe('cli');
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code_verifier')).toBe('v');
    expect(sent.get('client_secret')).toBeNull();
  });

  it('refreshes the pair without a secret', async () => {
    const { fetchImpl, calls } = mockFetch({
      'POST /oauth/token': [200, { access_token: 'a2', refresh_token: 'r2', expires_in: 3600, scope: 'developer-cli', token_type: 'Bearer' }],
    });
    const api = new DeveloperApi('https://api.test', { fetchImpl });
    const pair = await api.refreshTokens('r1');
    expect(pair.access_token).toBe('a2');
    expect(new URLSearchParams(calls[0].body as unknown as string).get('grant_type')).toBe('refresh_token');
  });

  it('hits config/versions/release/submit/test-stores/dev-installs on the built paths', async () => {
    const { fetchImpl, calls } = mockFetch({
      'GET /api/v1/biz/vendor/developer/apps/hello/config': ok({ p_id: 'app_1', slug: 'hello', version: '1.0.0', sequence: 1, review_status: 'live', manifest: MANIFEST }),
      'GET /api/v1/biz/vendor/developer/apps/hello/versions': ok([
        { version: '1.0.0', sequence: 1, review_status: 'live', changelog: null, is_current: true, created_at: null },
      ]),
      'POST /api/v1/biz/vendor/developer/apps/hello/versions/1.0.0/release': ok({ p_id: 'app_1', slug: 'hello' }),
      'POST /api/v1/biz/vendor/developer/apps/hello/submit': ok({ p_id: 'app_1', slug: 'hello', review_status: 'in_review', submitted_version: { version: '1.0.1', sequence: 2, review_status: 'in_review' } }),
      'GET /api/v1/biz/vendor/developer/test-stores?per_page=50': ok({ data: [{ p_id: 12, name: 'Test', slug: 'test' }], meta: { current_page: 1, per_page: 50, total: 1 } }),
      'POST /api/v1/biz/vendor/developer/apps/hello/dev-installs': [201, { status: 'success', message: 'ok', data: { installation_p_id: 'ins_1', store_p_id: 12, app_p_id: 'app_1', status: 'active', installed_version: '1.0.1' } }],
    });
    const api = new DeveloperApi('https://api.test', { fetchImpl, getAuth: userAuth() });
    expect((await api.appConfig('hello')).review_status).toBe('live');
    const { versions } = await api.appVersions('hello');
    expect(versions).toEqual([{ version: '1.0.0', sequence: 1, review_status: 'live', changelog: null, current: true, created_at: null }]);
    await api.releaseVersion('hello', '1.0.0');
    const submitted = await api.submitApp('hello');
    expect(submitted).toEqual({ review_status: 'in_review', version: '1.0.1' });
    const stores = await api.testStores();
    expect(stores.data[0].p_id).toBe(12);
    const installed = await api.devInstall('hello', 12);
    expect(installed.installation_p_id).toBe('ins_1');
    expect(calls.map((call) => `${call.method} ${call.url.replace('https://api.test', '')}`)).toEqual([
      'GET /api/v1/biz/vendor/developer/apps/hello/config',
      'GET /api/v1/biz/vendor/developer/apps/hello/versions',
      'POST /api/v1/biz/vendor/developer/apps/hello/versions/1.0.0/release',
      'POST /api/v1/biz/vendor/developer/apps/hello/submit',
      'GET /api/v1/biz/vendor/developer/test-stores?per_page=50',
      'POST /api/v1/biz/vendor/developer/apps/hello/dev-installs',
    ]);
    expect(calls[5].body).toEqual({ test_store_p_id: 12 });
  });

  it('retries once after a transparent refresh on 401, then throws', async () => {
    let hits = 0;
    const fetchImpl: FetchImpl = vi.fn(async () => {
      hits += 1;
      return (hits === 1
        ? { ok: false, status: 401, json: async () => ({ status: 'failed', error: 'Unauthenticated.', message: 'Unauthenticated.' }) }
        : { ok: true, status: 200, json: async () => ({ status: 'success', message: 'ok', data: { ok: true } }) }) as Response;
    });
    const api = new DeveloperApi('https://api.test', { fetchImpl, getAuth: userAuth(), onRefresh: async () => 'fresh' });
    await api.releaseVersion('hello', '1.0.0');
    expect(hits).toBe(2);
  });

  it('words automation 403s as wrong-app-or-grant, and never refreshes them', async () => {
    const fetchImpl: FetchImpl = vi.fn(async () => (
      { ok: false, status: 403, json: async () => ({ status: 'failed', error: 'Forbidden', message: 'Forbidden' }) } as Response
    ));
    const refreshed = vi.fn(async () => 'x');
    const api = new DeveloperApi('https://api.test', { fetchImpl, getAuth: autoAuth(), onRefresh: refreshed });
    const error = await api.releaseVersion('hello', '1.0.0').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AutomationTokenError);
    expect((error as Error).message).toContain('belongs to a different app');
    expect((error as Error).message).toContain("releasing version 1.0.0 of 'hello'");
    expect(refreshed).not.toHaveBeenCalled();
  });

  it('throws LoginNeededError-shaped auth failures with the server sentence', async () => {
    const { fetchImpl } = mockFetch({ 'POST /api/v1/biz/vendor/developer/apps': fail(422, 'The slug is taken.') });
    const api = new DeveloperApi('https://api.test', { fetchImpl, getAuth: userAuth() });
    const error = await api.deploy(MANIFEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('The slug is taken.');

    const refusing: FetchImpl = async () => {
      throw new Error('socket hang up');
    };
    const down = new DeveloperApi('https://api.test', { fetchImpl: refusing, getAuth: userAuth() });
    await expect(down.appVersions('hello')).rejects.toMatchObject({ status: 0 });
    expect(new LoginNeededError('x')).toBeInstanceOf(Error);
  });
});
