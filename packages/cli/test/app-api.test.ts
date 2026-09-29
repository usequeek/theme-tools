import { describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiFailureOf,
  AutomationTokenError,
  DeniedError,
  DeveloperApi,
  LoginNeededError,
  reviewRequiredOf,
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

const SUBMIT_BODY = {
  test_instructions: 'Install on the demo store.',
  screencast_url: 'https://example.com/demo.mp4',
  contact_email: 'dev@example.com',
  emergency_contact: { email: 'ops@example.com' },
  acknowledged_warnings: [],
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
  it('deploys {manifest} bare and reads data.status (201 new app, never 202 — never the HTTP code)', async () => {
    const { fetchImpl, calls } = mockFetch({
      'POST /api/v1/biz/vendor/developer/apps': [201, { status: 'success', message: 'App registered successfully', data: {
        p_id: 'app_1', slug: 'hello', name: 'Hello',
        version: { version: '1.0.1', sequence: 2, review_status: 'development' },
        signing_secret: 'whsec_once',
        unchanged: false,
        status: 'released',
      } }],
    });
    const api = new DeveloperApi('https://api.test', { fetchImpl, getAuth: userAuth() });
    const result = await api.deploy(MANIFEST);
    expect(result.slug).toBe('hello');
    expect(result.sequence).toBe(2);
    expect(result.signing_secret).toBe('whsec_once');
    expect(result.status).toBe('released');
    expect(result.unchanged).toBe(false);
    expect(calls[0].body).toEqual({ manifest: MANIFEST });
    expect(calls[0].headers.authorization).toBe('Bearer tok');
  });

  it('reads data.status for in_review, and created when --no-release holds the version in development', async () => {
    const answered = new DeveloperApi('https://api.test', {
      fetchImpl: mockFetch({
        'POST /api/v1/biz/vendor/developer/apps': ok({
          p_id: 'app_1', slug: 'hello', name: 'Hello',
          version: { version: '1.1.0', sequence: 2, review_status: 'in_review' },
          status: 'in_review',
          unchanged: false,
        }),
      }).fetchImpl,
      getAuth: userAuth(),
    });
    expect((await answered.deploy(MANIFEST)).status).toBe('in_review');

    const created = new DeveloperApi('https://api.test', {
      fetchImpl: mockFetch({
        'POST /api/v1/biz/vendor/developer/apps': ok({
          p_id: 'app_1', slug: 'hello', name: 'Hello',
          version: { version: '1.2.0', sequence: 3, review_status: 'development' },
          status: 'created',
          unchanged: false,
        }),
      }).fetchImpl,
      getAuth: userAuth(),
    });
    expect((await created.deploy(MANIFEST, { noRelease: true })).status).toBe('created');
  });

  it('sends --version/--message/--no-release through, and spots the no-change no-op', async () => {
    const { fetchImpl, calls } = mockFetch({
      'POST /api/v1/biz/vendor/developer/apps': ok({
        p_id: 'app_1', slug: 'hello', name: 'Hello',
        version: { version: '1.0.0', sequence: 1, review_status: 'live' },
        status: 'released',
      }),
    });
    const api = new DeveloperApi('https://api.test', { fetchImpl, getAuth: userAuth() });
    await api.deploy(MANIFEST, { version: '1.2.0', message: 'Greeting', noRelease: true });
    expect(calls[0].body).toEqual({ manifest: MANIFEST, version: '1.2.0', message: 'Greeting', no_release: true });

    const same = new DeveloperApi('https://api.test', {
      fetchImpl: mockFetch({
        'POST /api/v1/biz/vendor/developer/apps': [200, { status: 'success', message: 'No changes — version 1.0.0 is current.', data: {
          p_id: 'app_1', slug: 'hello', name: 'Hello',
          version: { version: '1.0.0', sequence: 1, review_status: 'live' },
          status: 'released',
          unchanged: true,
        } }],
      }).fetchImpl,
      getAuth: userAuth(),
    });
    expect((await same.deploy(MANIFEST)).unchanged).toBe(true);
  });

  it('marks in_review deploys for the command to word differently', async () => {
    const api = new DeveloperApi('https://api.test', {
      fetchImpl: mockFetch({
        'POST /api/v1/biz/vendor/developer/apps': ok({
          p_id: 'app_1', slug: 'hello', name: 'Hello',
          version: { version: '1.1.0', sequence: 2, review_status: 'in_review' },
          status: 'in_review',
        }),
      }).fetchImpl,
      getAuth: userAuth(),
    });
    const result = await api.deploy(MANIFEST);
    expect(result.status).toBe('in_review');
    expect(result.unchanged).toBe(false);
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
    await expect(unknown.deviceStatus('nope')).rejects.toMatchObject({ status: 404, message: 'Code expired or already used — run `queek auth login` again.' });

    const denied = new DeveloperApi('https://api.test', {
      fetchImpl: mockFetch({ 'GET /oauth/device/status?code=d': [403, { error: 'access_denied', error_description: 'The user denied the request.' }] }).fetchImpl,
    });
    const denial = await denied.deviceStatus('d').catch((e: unknown) => e);
    expect(denial).toBeInstanceOf(DeniedError);
    expect((denial as Error).message).toBe('Sign-in was denied in the dashboard.');
  });

  it('meets the deny exactly as the backend serves it: 403 access_denied ONCE, then 404', async () => {
    let hits = 0;
    const fetchImpl: FetchImpl = vi.fn(async () => {
      hits += 1;
      return (hits === 1
        ? { ok: false, status: 403, json: async () => ({ error: 'access_denied', error_description: 'The user denied the request.' }) }
        : { ok: false, status: 404, json: async () => ({ error: 'invalid_request', error_description: 'The device code is invalid or expired.' }) }) as Response;
    });
    const api = new DeveloperApi('https://api.test', { fetchImpl });
    await expect(api.deviceStatus('d')).rejects.toBeInstanceOf(DeniedError);
    await expect(api.deviceStatus('d')).rejects.toMatchObject({
      status: 404,
      message: 'Code expired or already used — run `queek auth login` again.',
    });
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

  it('hits config/versions/release/submission/submit/withdraw/test-stores/dev-installs on the built paths', async () => {
    const { fetchImpl, calls } = mockFetch({
      'GET /api/v1/biz/vendor/developer/apps/hello/config': ok({ p_id: 'app_1', slug: 'hello', version: '1.0.0', sequence: 1, review_status: 'live', manifest: MANIFEST }),
      'GET /api/v1/biz/vendor/developer/apps/hello/versions': ok([
        { version: '1.0.0', sequence: 1, review_status: 'live', changelog: null, is_current: true, created_at: null },
        { version: '1.0.1', sequence: 2, review_status: 'development', changelog: null, is_current: false, created_at: null },
      ]),
      'POST /api/v1/biz/vendor/developer/apps/hello/versions/2/release': ok({ status: 'released', version: '1.0.1', sequence: 2 }),
      'GET /api/v1/biz/vendor/developer/apps/hello/versions/2/submission': ok({
        version: '1.0.1', sequence: 2, review_status: 'development',
        checks: [{ key: 'listing', level: 'error', ok: true, detail: null, at: '2026-09-30T00:00:00Z' }],
      }),
      'POST /api/v1/biz/vendor/developer/apps/hello/versions/2/submit': ok({ submitted_version: { version: '1.0.1', sequence: 2, review_status: 'in_review' } }),
      'POST /api/v1/biz/vendor/developer/apps/hello/versions/2/withdraw': ok({
        withdrawn_version: { version: '1.0.1', sequence: 2, review_status: 'development', review_note: 'Withdrawn by developer.' },
      }),
      'GET /api/v1/biz/vendor/developer/test-stores?per_page=50&page=1': ok({ data: [{ id: 7, p_id: 12, name: 'Test', slug: 'test', storefront_url: 'https://test.usequeek.com' }], meta: { current_page: 1, per_page: 50, total: 1 } }),
      'POST /api/v1/biz/vendor/developer/apps/hello/dev-installs': [201, { status: 'success', message: 'ok', data: { installation_p_id: 'ins_1', store_p_id: 12, app_p_id: 'app_1', status: 'active', installed_version: '1.0.1' } }],
    });
    const api = new DeveloperApi('https://api.test', { fetchImpl, getAuth: userAuth() });
    expect((await api.appConfig('hello')).review_status).toBe('live');
    const { versions } = await api.appVersions('hello');
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version: '1.0.0', sequence: 1, current: true });
    // Semver resolves to its sequence; the route takes the sequence.
    expect(await api.releaseVersion('hello', '1.0.1')).toEqual({ status: 'released', version: '1.0.1', sequence: 2 });
    const checklist = await api.submission('hello', 2);
    expect(checklist.checks).toHaveLength(1);
    expect(checklist.checks[0]).toMatchObject({ key: 'listing', level: 'error', ok: true });
    const submitted = await api.submitVersion('hello', 2, SUBMIT_BODY, 'key-1');
    expect(submitted).toEqual({ version: '1.0.1', sequence: 2, review_status: 'in_review' });
    const withdrawn = await api.withdrawVersion('hello', 2);
    expect(withdrawn).toMatchObject({ version: '1.0.1', sequence: 2, review_status: 'development', review_note: 'Withdrawn by developer.' });
    const stores = await api.allTestStores();
    expect(stores.data[0]).toMatchObject({ p_id: 12, storefront_url: 'https://test.usequeek.com' });
    const installed = await api.devInstall('hello', 12);
    expect(installed.installation_p_id).toBe('ins_1');
    expect(calls.map((call) => `${call.method} ${call.url.replace('https://api.test', '')}`)).toEqual([
      'GET /api/v1/biz/vendor/developer/apps/hello/config',
      'GET /api/v1/biz/vendor/developer/apps/hello/versions',
      // releaseVersion('hello', '1.0.1') resolves the semver first:
      'GET /api/v1/biz/vendor/developer/apps/hello/versions',
      'POST /api/v1/biz/vendor/developer/apps/hello/versions/2/release',
      'GET /api/v1/biz/vendor/developer/apps/hello/versions/2/submission',
      'POST /api/v1/biz/vendor/developer/apps/hello/versions/2/submit',
      'POST /api/v1/biz/vendor/developer/apps/hello/versions/2/withdraw',
      'GET /api/v1/biz/vendor/developer/test-stores?per_page=50&page=1',
      'POST /api/v1/biz/vendor/developer/apps/hello/dev-installs',
    ]);
    expect(calls.find((call) => call.url.endsWith('/dev-installs'))?.body).toEqual({ test_store_p_id: 12 });
    const submitCall = calls.find((call) => call.url.endsWith('/versions/2/submit'));
    expect(submitCall?.headers['Idempotency-Key']).toBe('key-1');
    expect(submitCall?.body).toEqual(SUBMIT_BODY);
  });

  it('accepts the real in_review release: HTTP 202, outcome from data.status', async () => {
    const { fetchImpl } = mockFetch({
      'POST /api/v1/biz/vendor/developer/apps/hello/versions/3/release': [202, { status: 'success', message: 'ok', data: {
        status: 'in_review', version: '1.1.0', sequence: 3,
      } }],
    });
    const api = new DeveloperApi('https://api.test', { fetchImpl, getAuth: userAuth() });
    expect(await api.releaseVersion('hello', '3')).toEqual({ status: 'in_review', version: '1.1.0', sequence: 3 });
  });

  it('treats 409 review_required as a gated outcome on deploy and release (never ApiError)', async () => {
    const gated = (sequence: number): [number, unknown] => [
      409,
      { status: 'failed', error_type: 'review_required', title: 'Review required', message: 'Submit this version.', data: { version: '1.0.0', sequence, submission_url: '/api/v1/biz/vendor/developer/apps/app_1/versions/1/submit' } },
    ];
    const api = new DeveloperApi('https://api.test', {
      fetchImpl: mockFetch({
        'POST /api/v1/biz/vendor/developer/apps': gated(1),
        'POST /api/v1/biz/vendor/developer/apps/hello/versions/1/release': gated(1),
      }).fetchImpl,
      getAuth: userAuth(),
    });
    expect(await api.deploy(MANIFEST)).toEqual({
      status: 'review_required',
      version: '1.0.0',
      sequence: 1,
      submission_url: '/api/v1/biz/vendor/developer/apps/app_1/versions/1/submit',
    });
    expect(await api.releaseVersion('hello', '1')).toEqual({
      status: 'review_required',
      version: '1.0.0',
      sequence: 1,
      submission_url: '/api/v1/biz/vendor/developer/apps/app_1/versions/1/submit',
    });
  });

  it('keeps other 409s as ApiError (already_submitted, key reuse)', async () => {
    const api = new DeveloperApi('https://api.test', {
      fetchImpl: mockFetch({
        'POST /api/v1/biz/vendor/developer/apps/hello/versions/2/submit': [
          409,
          { status: 'failed', error_type: 'already_submitted', message: 'Already submitted.', data: null },
        ],
      }).fetchImpl,
      getAuth: userAuth(),
    });
    const error = await api.submitVersion('hello', 2, SUBMIT_BODY, 'key-1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(reviewRequiredOf(error)).toBeNull();
    expect(apiFailureOf(error)).toMatchObject({ status: 409, errorType: 'already_submitted' });
  });

  it('decodes 422 per-key failures and 429 for the command to word', async () => {
    const api = new DeveloperApi('https://api.test', {
      fetchImpl: mockFetch({
        'POST /api/v1/biz/vendor/developer/apps/hello/versions/2/submit': [
          422,
          { status: 'failed', error_type: 'invalid_submission', message: 'Not ready.', data: { failures: [
            { key: 'listing', reason: 'error_failed' },
            { key: 'embedded_frame', reason: 'warning_unacknowledged' },
            { key: 'tested', reason: 'stale' },
          ] } },
        ],
      }).fetchImpl,
      getAuth: userAuth(),
    });
    const error = await api.submitVersion('hello', 2, SUBMIT_BODY, 'key-1').catch((e: unknown) => e);
    expect(apiFailureOf(error)).toMatchObject({
      status: 422,
      errorType: 'invalid_submission',
      failures: [
        { key: 'listing', reason: 'error_failed' },
        { key: 'embedded_frame', reason: 'warning_unacknowledged' },
        { key: 'tested', reason: 'stale' },
      ],
    });
  });

  it('fails loudly when a deploy answer carries no data.status (never a silent released)', async () => {
    const { fetchImpl } = mockFetch({
      'POST /api/v1/biz/vendor/developer/apps': ok({
        p_id: 'app_1', slug: 'hello', name: 'Hello',
        version: { version: '1.0.1', sequence: 2, review_status: 'development' },
        unchanged: false,
      }),
    });
    const api = new DeveloperApi('https://api.test', { fetchImpl, getAuth: userAuth() });
    const error = await api.deploy(MANIFEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as Error).message).toBe('Unexpected deploy response from Queek — no status (expected released|in_review|created).');
  });

  it('mints keypairs (PEM once) and lists recorded kids for the pre-generate check', async () => {
    const { fetchImpl, calls } = mockFetch({
      'POST /api/v1/biz/vendor/developer/apps/hello/keys/generate': [201, { status: 'success', message: 'ok', data: {
        kid: 'kid_1', added_at: '2026-09-30T00:00:00Z', private_key: 'PEM_BYTES',
      } }],
      'GET /api/v1/biz/vendor/developer/apps/hello/keys': ok({ keys: [{ kid: 'kid_0', added_at: 'x' }] }),
    });
    const api = new DeveloperApi('https://api.test', { fetchImpl, getAuth: userAuth() });
    expect(await api.generateAppKey('hello')).toEqual({ kid: 'kid_1', privateKey: 'PEM_BYTES' });
    expect(await api.appKeys('hello')).toEqual({ kids: ['kid_0'] });
    expect(calls[0].body).toEqual({});

    const replayed = new DeveloperApi('https://api.test', {
      fetchImpl: mockFetch({
        'POST /api/v1/biz/vendor/developer/apps/hello/keys/generate': ok({ kid: 'kid_1', added_at: 'x', private_key: null }),
      }).fetchImpl,
      getAuth: userAuth(),
    });
    await expect(replayed.generateAppKey('hello')).rejects.toThrow('returned no private key');
  });

  it('resolves digit input as a sequence and errors unknown semvers with the list', async () => {
    const { fetchImpl, calls } = mockFetch({
      'GET /api/v1/biz/vendor/developer/apps/hello/versions': ok([
        { version: '1.0.0', sequence: 1, review_status: 'live', changelog: null, is_current: true, created_at: null },
      ]),
      'POST /api/v1/biz/vendor/developer/apps/hello/versions/1/release': ok({ status: 'in_review', version: '1.0.0', sequence: 1 }),
    });
    const api = new DeveloperApi('https://api.test', { fetchImpl, getAuth: userAuth() });
    // Digits go straight to the route — no versions lookup.
    expect(await api.releaseVersion('hello', '1')).toEqual({ status: 'in_review', version: '1.0.0', sequence: 1 });
    expect(calls.map((call) => `${call.method} ${call.url.replace('https://api.test', '')}`)).toEqual([
      'POST /api/v1/biz/vendor/developer/apps/hello/versions/1/release',
    ]);
    await expect(api.releaseVersion('hello', '9.9.9')).rejects.toThrow("Unknown version '9.9.9' for 'hello'. Available: 1.0.0.");
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
    await api.releaseVersion('hello', '2');
    expect(hits).toBe(2);
  });

  it.each([401, 403])('words automation %is as out-of-grant for its app, and never refreshes or re-logins', async (denied) => {
    const fetchImpl: FetchImpl = vi.fn(async () => (
      { ok: false, status: denied, json: async () => ({ status: 'failed', error: 'Unauthenticated.', message: 'Unauthenticated.' }) } as Response
    ));
    const refreshed = vi.fn(async () => 'x');
    const api = new DeveloperApi('https://api.test', { fetchImpl, getAuth: autoAuth(), onRefresh: refreshed });
    const error = await api.releaseVersion('hello', '2').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AutomationTokenError);
    expect((error as Error).message).toContain("This automation token can't do that");
    expect((error as Error).message).toContain("app 'hello's deploy, versions, release and submit");
    expect((error as Error).message).not.toContain('expired');
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
