import { describe, expect, it, vi } from 'vitest';
import { ApiError, DeveloperApi, type FetchImpl } from '../src/lib/app-api.js';

const MANIFEST = {
  slug: 'hello',
  name: 'Hello',
  scopes: ['merchant-business_profile-read'],
  install_url: 'https://hello.example.com/install',
  uninstall_url: 'https://hello.example.com/uninstall',
};

/** A canned fetch: method + path → [status, body]. */
function mockFetch(routes: Record<string, [number, unknown]>) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
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
    calls.push({ method, url, body: parsedBody });
    const [status, body] = routes[`${method} ${path}`] ?? [500, { message: 'no mock' }];
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  });
  return { fetchImpl, calls };
}

describe('DeveloperApi (mocked HTTP — the backend slice builds in parallel)', () => {
  it('deploys the toml manifest to POST vendor/developer/apps', async () => {
    const { fetchImpl, calls } = mockFetch({
      'POST /vendor/developer/apps': [200, { p_id: 'app_1', slug: 'hello', version: '1.0.1', sequence: 2, secret: 'whsec_once' }],
    });
    const api = new DeveloperApi('https://api.test', fetchImpl);
    const result = await api.deploy('tok', MANIFEST);
    expect(result.slug).toBe('hello');
    expect(result.secret).toBe('whsec_once');
    expect(calls[0].body).toMatchObject({ slug: 'hello' });
  });

  it('reads the device poll: 202 pending, 200 approved, 404 unknown', async () => {
    const pending = new DeveloperApi('https://api.test', mockFetch({ 'GET /developer/device/status?code=abc': [202, null] }).fetchImpl);
    expect(await pending.deviceStatus('abc')).toBeNull();

    const approved = new DeveloperApi(
      'https://api.test',
      mockFetch({ 'GET /developer/device/status?code=abc': [200, { token: 'tok123' }] }).fetchImpl,
    );
    expect(await approved.deviceStatus('abc')).toEqual({ token: 'tok123' });

    const unknown = new DeveloperApi(
      'https://api.test',
      mockFetch({ 'GET /developer/device/status?code=nope': [404, { message: 'Unknown code.' }] }).fetchImpl,
    );
    await expect(unknown.deviceStatus('nope')).rejects.toMatchObject({ status: 404 });
  });

  it('exchanges the PKCE code as OAuth form fields with client_id=cli', async () => {
    const { fetchImpl, calls } = mockFetch({ 'POST /oauth/token': [200, { access_token: 'tok123' }] });
    const api = new DeveloperApi('https://api.test', fetchImpl);
    expect(await api.oauthToken({ code: 'c', code_verifier: 'v', redirect_uri: 'http://127.0.0.1:9/callback' })).toEqual({ token: 'tok123' });
    const sent = new URLSearchParams(calls[0].body as unknown as string);
    expect(sent.get('client_id')).toBe('cli');
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code_verifier')).toBe('v');
  });

  it('hits the config/versions/release/submit shapes from the plan', async () => {
    const { fetchImpl, calls } = mockFetch({
      'GET /vendor/developer/apps/hello/config': [200, { p_id: 'app_1', slug: 'hello', version: '1.0.0', sequence: 1, review_status: 'live', manifest: MANIFEST }],
      'GET /vendor/developer/apps/hello/versions': [200, { versions: [{ version: '1.0.0', sequence: 1, review_status: 'live', current: true }] }],
      'POST /vendor/developer/apps/hello/versions/1.0.0/release': [200, { ok: true }],
      'POST /vendor/developer/apps/hello/submit': [200, { ok: true }],
      'GET /vendor/developer/test-stores': [200, { data: [{ p_id: 'tst_1', name: 'Test' }] }],
      'POST /vendor/developer/apps/hello/dev-installs': [200, { ok: true }],
    });
    const api = new DeveloperApi('https://api.test', fetchImpl);
    expect((await api.appConfig('tok', 'hello')).review_status).toBe('live');
    expect((await api.appVersions('tok', 'hello')).versions).toHaveLength(1);
    await api.releaseVersion('tok', 'hello', '1.0.0');
    await api.submitApp('tok', 'hello');
    expect((await api.testStores('tok')).data[0].p_id).toBe('tst_1');
    await api.devInstall('tok', 'hello', 'tst_1');
    expect(calls.map((call) => `${call.method} ${call.url.replace('https://api.test', '')}`)).toEqual([
      'GET /vendor/developer/apps/hello/config',
      'GET /vendor/developer/apps/hello/versions',
      'POST /vendor/developer/apps/hello/versions/1.0.0/release',
      'POST /vendor/developer/apps/hello/submit',
      'GET /vendor/developer/test-stores',
      'POST /vendor/developer/apps/hello/dev-installs',
    ]);
  });

  it('wraps unreachable backends and server errors as ApiError', async () => {
    const refusing: FetchImpl = async () => {
      throw new Error('socket hang up');
    };
    const down = new DeveloperApi('https://api.test', refusing);
    await expect(down.appVersions('tok', 'hello')).rejects.toMatchObject({ status: 0 });

    const { fetchImpl } = mockFetch({ 'POST /vendor/developer/apps': [422, { message: 'The slug is taken.' }] });
    const api = new DeveloperApi('https://api.test', fetchImpl);
    const error = await api.deploy('tok', MANIFEST).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('The slug is taken.');
  });
});
