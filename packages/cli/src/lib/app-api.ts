import type { AppManifest } from './app-manifest.js';

/**
 * The developer API the `app` commands talk to. Every route below is either
 * already on origin/master (`vendor/developer/*`, `oauth/*`) or the plan's
 * §2 contract the backend slice builds in parallel — the client sends exactly
 * the plan's shapes, and every guess is marked ASSUMPTION with its plan
 * section so the senior can diff it against the merged backend.
 *
 * Contract assumptions (see also open_questions in the impl report):
 * - A1 §Auth: API base defaults to `https://api.usequeek.com`
 *   (`QUEEK_API_BASE` overrides).
 * - A2 §Auth: browser login reuses `GET {api}/oauth/authorize` +
 *   `POST {api}/oauth/token` with `client_id=cli`, PKCE, and a loopback
 *   redirect. The token endpoint takes OAuth form fields.
 * - A3 §Auth: headless fallback is `POST {api}/developer/device/code`
 *   (unauthenticated issue) + `GET {api}/developer/device/status?code=`
 *   (202 pending, 200 approved with the token, 404 unknown).
 * - A4 §2.2–2.4 + Shopify check: `GET vendor/developer/test-stores`,
 *   `POST vendor/developer/apps/{app}/dev-installs {test_store_p_id}`,
 *   `GET vendor/developer/apps/{app}/config`, plus
 *   `GET vendor/developer/apps/{app}/versions` and
 *   `POST vendor/developer/apps/{app}/versions/{version}/release`
 *   on the existing AppVersion model (neither route exists on master today).
 * - A5: `@usequeek/app-sdk@^0.4.0` on npm (404 at implementation time).
 */

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

export interface DeviceCode {
  code: string;
  verify_url: string;
  expires_in: number;
}

export interface TestStore {
  p_id: string;
  name: string;
  [key: string]: unknown;
}

export interface AppVersion {
  version: string;
  sequence: number;
  review_status: string;
  current: boolean;
  [key: string]: unknown;
}

export interface DeployResult {
  p_id: string;
  slug: string;
  version: string;
  sequence: number;
  /** Shown ONCE on first registration — never returned again. */
  secret?: string;
  [key: string]: unknown;
}

export interface AppConfig {
  p_id: string;
  slug: string;
  version: string;
  sequence: number;
  review_status: string;
  manifest: Record<string, unknown>;
}

const jsonHeaders = (token?: string): Record<string, string> => ({
  'content-type': 'application/json',
  accept: 'application/json',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

export class DeveloperApi {
  constructor(
    private readonly base: string,
    private readonly fetchImpl: FetchImpl = fetch,
  ) {}

  private async request<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}${path}`, {
        method,
        headers: jsonHeaders(token),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      throw new ApiError(`Cannot reach ${this.base}: ${(error as Error).message}`, 0, null);
    }
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const message =
        (data as { message?: unknown } | null)?.message ??
        (data as { error?: unknown } | null)?.error ??
        `Request failed with status ${response.status}.`;
      throw new ApiError(typeof message === 'string' ? message : `Request failed with status ${response.status}.`, response.status, data);
    }
    return data as T;
  }

  /** A3: issue a headless device code (unauthenticated). */
  deviceCode(): Promise<DeviceCode> {
    return this.request<DeviceCode>('POST', '/developer/device/code');
  }

  /** A3: poll until approval. 202 = still pending (null), 200 = approved. */
  async deviceStatus(code: string): Promise<{ token: string } | null> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}/developer/device/status?code=${encodeURIComponent(code)}`, {
        headers: { accept: 'application/json' },
      });
    } catch (error) {
      throw new ApiError(`Cannot reach ${this.base}: ${(error as Error).message}`, 0, null);
    }
    if (response.status === 202) return null;
    const data = (await response.json().catch(() => null)) as { token?: unknown; message?: unknown } | null;
    if (!response.ok) {
      const message = data?.message;
      throw new ApiError(typeof message === 'string' ? message : `Request failed with status ${response.status}.`, response.status, data);
    }
    if (!data || typeof data.token !== 'string') throw new ApiError('The device approval returned no token.', response.status, data);
    return { token: data.token };
  }

  /** A2: PKCE code-for-token exchange against the reused OAuth machinery. */
  async oauthToken(input: { code: string; code_verifier: string; redirect_uri: string }): Promise<{ token: string }> {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: 'cli',
      code: input.code,
      code_verifier: input.code_verifier,
      redirect_uri: input.redirect_uri,
    });
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.base}/oauth/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: params.toString(),
      });
    } catch (error) {
      throw new ApiError(`Cannot reach ${this.base}: ${(error as Error).message}`, 0, null);
    }
    const data = (await response.json().catch(() => null)) as { access_token?: unknown; token?: unknown; message?: unknown } | null;
    if (!response.ok) {
      const message = data?.message;
      throw new ApiError(typeof message === 'string' ? message : `Request failed with status ${response.status}.`, response.status, data);
    }
    const token = data?.access_token ?? data?.token;
    if (typeof token !== 'string') throw new ApiError('The login returned no token.', response.status, data);
    return { token };
  }

  /** A4: the owned test stores a `--store` selector reads. */
  testStores(token: string): Promise<{ data: TestStore[] }> {
    return this.request<{ data: TestStore[] }>('GET', '/vendor/developer/test-stores', token);
  }

  /** A4: install an unreviewed dev build on an owned test store. */
  devInstall(token: string, app: string, testStorePId: string): Promise<unknown> {
    return this.request('POST', `/vendor/developer/apps/${encodeURIComponent(app)}/dev-installs`, token, { test_store_p_id: testStorePId });
  }

  /** `deploy`: toml → version N+1. `development` stays off the listing. */
  deploy(token: string, manifest: AppManifest): Promise<DeployResult> {
    return this.request<DeployResult>('POST', '/vendor/developer/apps', token, manifest);
  }

  /** A4: server → toml (`config link`). */
  appConfig(token: string, app: string): Promise<AppConfig> {
    return this.request<AppConfig>('GET', `/vendor/developer/apps/${encodeURIComponent(app)}/config`, token);
  }

  /** A4: every version snapshot, newest first. */
  appVersions(token: string, app: string): Promise<{ versions: AppVersion[] }> {
    return this.request<{ versions: AppVersion[] }>('GET', `/vendor/developer/apps/${encodeURIComponent(app)}/versions`, token);
  }

  /** A4: revert serving to a previous version snapshot. */
  releaseVersion(token: string, app: string, version: string): Promise<unknown> {
    return this.request('POST', `/vendor/developer/apps/${encodeURIComponent(app)}/versions/${encodeURIComponent(version)}/release`, token);
  }

  /** Existing channel: version → `in_review`. */
  submitApp(token: string, app: string): Promise<unknown> {
    return this.request('POST', `/vendor/developer/apps/${encodeURIComponent(app)}/submit`, token);
  }
}
