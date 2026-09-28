import type { AppManifest } from './app-manifest.js';

/**
 * The developer API the `app` commands talk to, verified against the S1
 * backend slice (devflow-s1 @ 9de8c58c) — every row of the call→route table
 * in the impl report names its serving route + file:line.
 *
 * Two routers on one host (`QUEEK_API_BASE`): vendor API at
 * `{base}/api/v1/biz/...`, OAuth at `{base}/oauth/...` (web router, no /api
 * prefix). Every vendor response wears the `{status, message, data}`
 * envelope (Controller.php:21); OAuth failures wear
 * `{error, error_description}` (OAuthException.php:54).
 *
 * Auth kinds: a CI automation token (`QUEEK_APP_AUTOMATION_TOKEN`, per-app,
 * dashboard-minted) is used as-is — a 403 names the app + action instead of
 * dumping the envelope. A developer session refreshes its 60-minute access
 * token transparently (pre-expiry + one retry on 401).
 */

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

export type AuthKind = 'automation' | 'user';

export interface AuthContext {
  token: string;
  kind: AuthKind;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
  ) {
    super(message);
  }
}

/** A 403 under an automation token: wrong app or beyond its grant. */
export class AutomationTokenError extends ApiError {}

/** The session is gone (refresh refused): the user must log in again. */
export class LoginNeededError extends Error {}

export interface DeviceCode {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface TokenPair {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

export interface TestStore {
  p_id: number;
  name: string;
  slug: string;
}

export interface AppVersion {
  version: string;
  sequence: number;
  review_status: string;
  changelog: string | null;
  current: boolean;
  created_at: string | null;
}

export interface DeployOptions {
  /** Optional X.Y.Z name (Shopify `--version`); absent → backend auto-assigns the next patch. */
  version?: string;
  /** Optional release note (Shopify `--message`). */
  message?: string;
  /** Create the version without releasing it (Shopify `--no-release`). */
  noRelease?: boolean;
}

export interface DeployResult {
  p_id: string;
  slug: string;
  name: string;
  version: string;
  sequence: number;
  review_status: string;
  /** `released` by default; `in_review` when the version needs admin review first. */
  status: string;
  /** True when the manifest was identical: no version was cut. */
  unchanged: boolean;
  /** Shown ONCE on first registration — never returned again. */
  signing_secret?: string;
}

export interface ReleaseResult {
  /** `released` (serving now) or `in_review` (releases when approved). */
  status: string;
  version: string | null;
}

export interface AppConfig {
  p_id: string;
  slug: string;
  version: string;
  sequence: number;
  review_status: string;
  manifest: Record<string, unknown>;
}

export interface DevInstallResult {
  installation_p_id: string;
  store_p_id: number;
  app_p_id: string;
  status: string;
  installed_version: string;
}

const VENDOR_PREFIX = '/api/v1/biz/vendor/developer';
const OAUTH_PREFIX = '/oauth';

function messageOf(body: unknown, status: number): string {
  if (body !== null && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    // OAuth failures: {error, error_description} — the description is the sentence.
    if (typeof record.error_description === 'string' && record.error_description !== '') return record.error_description;
    if (typeof record.message === 'string' && record.message !== '') return record.message;
    if (typeof record.error === 'string' && record.error !== '') return record.error;
  }
  return `Request failed with status ${status}.`;
}

export interface ClientOptions {
  fetchImpl?: FetchImpl;
  /** Current bearer + kind. Called per request so refreshes apply immediately. */
  getAuth?: () => Promise<AuthContext>;
  /** Force a session refresh; return the fresh access token or throw LoginNeededError. */
  onRefresh?: () => Promise<string>;
}

export class DeveloperApi {
  private readonly fetchImpl: FetchImpl;
  private readonly getAuth: () => Promise<AuthContext>;
  private readonly onRefresh?: () => Promise<string>;

  constructor(
    private readonly base: string,
    options: ClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.getAuth = options.getAuth ?? (async () => { throw new LoginNeededError('Not logged in — run `queek auth login` first.'); });
    this.onRefresh = options.onRefresh;
  }

  private async raw(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (error) {
      throw new ApiError(`Cannot reach ${this.base}: ${(error as Error).message}`, 0, null);
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }

  /**
   * One vendor call: bearer from the session layer, `{data}` unwrapped,
   * one transparent refresh-and-retry on 401 (user sessions only), and a
   * plain-words 403 for automation tokens. `action` words the 403
   * ("deploying", "releasing version 1.2.0 of", ...).
   */
  private async vendor<T>(method: string, path: string, action: string, body?: unknown): Promise<{ data: T; message: string }> {
    const attempt = async (token: string, kind: AuthKind, retried: boolean): Promise<{ data: unknown; message: string }> => {
      const { status, body: raw } = await this.raw(`${this.base}${VENDOR_PREFIX}${path}`, {
        method,
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // One transparent refresh-and-retry on 401 (user sessions only): a
      // second 401 throws below instead of looping.
      if (status === 401 && kind === 'user' && !retried && this.onRefresh) {
        const fresh = await this.onRefresh();
        return attempt(fresh, kind, true);
      }
      if (status === 403 && kind === 'automation') {
        const detail = messageOf(raw, status);
        throw new AutomationTokenError(
          `Access refused ${action} — this automation token belongs to a different app or cannot do that. (Server: ${detail})`,
          status,
          raw,
        );
      }
      if (status < 200 || status >= 300) throw new ApiError(messageOf(raw, status), status, raw);
      const envelope = (raw ?? {}) as { data?: unknown; message?: unknown };
      return { data: envelope.data ?? null, message: typeof envelope.message === 'string' ? envelope.message : '' };
    };

    const auth = await this.getAuth();
    const { data, message } = await attempt(auth.token, auth.kind, false);
    return { data: data as T, message };
  }

  // ── OAuth (web router, unauthenticated except by code/verifier) ──

  /** Issue a headless device pair (AgentOAuthController.php:84). */
  async deviceCode(): Promise<DeviceCode> {
    const { status, body } = await this.raw(`${this.base}${OAUTH_PREFIX}/device/code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_id: 'cli', scope: 'developer-cli' }),
    });
    if (status < 200 || status >= 300) throw new ApiError(messageOf(body, status), status, body);
    const record = body as Record<string, unknown>;
    if (typeof record.device_code !== 'string' || typeof record.user_code !== 'string' || typeof record.verification_uri !== 'string') {
      throw new ApiError('The device endpoint returned an unexpected shape.', status, body);
    }
    return {
      device_code: record.device_code,
      user_code: record.user_code,
      verification_uri: record.verification_uri,
      expires_in: typeof record.expires_in === 'number' ? record.expires_in : 600,
      interval: typeof record.interval === 'number' ? record.interval : 5,
    };
  }

  /** Poll until approval: 202 pending → null, 200 → token pair (AgentOAuthController.php:97). */
  async deviceStatus(deviceCode: string): Promise<TokenPair | null> {
    const { status, body } = await this.raw(`${this.base}${OAUTH_PREFIX}/device/status?code=${encodeURIComponent(deviceCode)}`, {
      headers: { accept: 'application/json' },
    });
    if (status === 202) return null;
    if (status < 200 || status >= 300) throw new ApiError(messageOf(body, status), status, body);
    return tokenPairOf(body, status);
  }

  /**
   * PKCE code-for-token exchange (AgentOAuthController.php:54). Sent WITHOUT
   * client_secret on purpose: the CLI is a public native client (RFC 8252) —
   * a secret baked into npm tarballs is not a secret. If the backend keeps
   * requiring one for `cli`, it 401s `invalid_client` and that is a backend
   * must-fix (see open_questions), not something to smuggle in here.
   */
  async oauthToken(input: { code: string; code_verifier: string; redirect_uri: string }): Promise<TokenPair> {
    return this.tokenGrant({
      grant_type: 'authorization_code',
      client_id: 'cli',
      code: input.code,
      code_verifier: input.code_verifier,
      redirect_uri: input.redirect_uri,
    });
  }

  /** Rotate a refresh token into a fresh pair (AgentOAuthService.php:219). */
  async refreshTokens(refreshToken: string): Promise<TokenPair> {
    return this.tokenGrant({ grant_type: 'refresh_token', client_id: 'cli', refresh_token: refreshToken });
  }

  private async tokenGrant(params: Record<string, string>): Promise<TokenPair> {
    const form = new URLSearchParams(params);
    const { status, body } = await this.raw(`${this.base}${OAUTH_PREFIX}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: form.toString(),
    });
    if (status < 200 || status >= 300) throw new ApiError(messageOf(body, status), status, body);
    return tokenPairOf(body, status);
  }

  /**
   * Best-effort revoke for `auth logout` (AgentOAuthController.php:72). The
   * backend authenticates the client here too, so a public CLI without a
   * secret is refused — the caller ignores the refusal and always clears
   * local creds (secretless revoke is backend must-fix #2).
   */
  async revokeToken(token: string): Promise<boolean> {
    const { status } = await this.raw(`${this.base}${OAUTH_PREFIX}/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_id: 'cli', token }),
    });
    return status >= 200 && status < 300;
  }

  // ── Developer surface (vendor router, bearer) ──

  /**
   * Deploy: toml → version N+1, released by default (DeveloperAppController.php:180).
   * The manifest carries no `version` — `options.version` names one, otherwise
   * the backend auto-assigns the next patch. `message` rides both `message`
   * and `changelog` (S1 validated `changelog`; the parallel review-policy
   * build reads `message` — harmless duplication, confirmed in open_questions).
   */
  async deploy(manifest: AppManifest, options: DeployOptions = {}): Promise<DeployResult> {
    const { data, message } = await this.vendor<Record<string, unknown>>('POST', '/apps', 'deploying this app', {
      manifest,
      ...(options.version !== undefined ? { version: options.version } : {}),
      ...(options.message !== undefined ? { message: options.message, changelog: options.message } : {}),
      ...(options.noRelease ? { no_release: true } : {}),
    });
    const version = (data.version ?? {}) as Record<string, unknown>;
    const unchanged = data.unchanged === true || /no changes/i.test(message);
    return {
      p_id: data.p_id as string,
      slug: data.slug as string,
      name: data.name as string,
      version: version.version as string,
      sequence: version.sequence as number,
      review_status: version.review_status as string,
      status: typeof data.status === 'string' ? data.status : 'released',
      unchanged,
      ...(typeof data.signing_secret === 'string' ? { signing_secret: data.signing_secret } : {}),
    };
  }

  /** Owned test stores for the `--store` selector (DeveloperAppController.php:239). */
  async testStores(): Promise<{ data: TestStore[]; total: number }> {
    const { data } = await this.vendor<{ data: TestStore[]; meta: { total: number } }>('GET', '/test-stores?per_page=50', 'listing test stores');
    return { data: data.data, total: data.meta.total };
  }

  /** Install an unreviewed dev build on an owned test store (DeveloperAppController.php:268). */
  async devInstall(app: string, testStorePId: number, settings?: Record<string, unknown>): Promise<DevInstallResult> {
    const { data } = await this.vendor<DevInstallResult>('POST', `/apps/${encodeURIComponent(app)}/dev-installs`, `installing a dev build of '${app}'`, {
      test_store_p_id: testStorePId,
      ...(settings !== undefined ? { settings } : {}),
    });
    return data;
  }

  /** Server → toml (DeveloperAppController.php:308). */
  async appConfig(app: string): Promise<AppConfig> {
    const { data } = await this.vendor<AppConfig>('GET', `/apps/${encodeURIComponent(app)}/config`, `linking config of '${app}'`);
    return data;
  }

  /** Every version snapshot, newest first (DeveloperAppController.php:342). */
  async appVersions(app: string): Promise<{ versions: AppVersion[] }> {
    const { data: rows } = await this.vendor<Record<string, unknown>[]>('GET', `/apps/${encodeURIComponent(app)}/versions`, `listing versions of '${app}'`);
    return {
      versions: rows.map((row) => ({
        version: row.version as string,
        sequence: row.sequence as number,
        review_status: row.review_status as string,
        changelog: (row.changelog ?? null) as string | null,
        current: row.is_current as boolean,
        created_at: (row.created_at ?? null) as string | null,
      })),
    };
  }

  /** Serve a created version: released now, or held in review (review-policy §116). */
  async releaseVersion(app: string, version: string): Promise<ReleaseResult> {
    const { data } = await this.vendor<Record<string, unknown>>('POST', `/apps/${encodeURIComponent(app)}/versions/${encodeURIComponent(version)}/release`, `releasing version ${version} of '${app}'`);
    const status = typeof data.status === 'string' ? data.status : 'released';
    const released = (data.version ?? {}) as Record<string, unknown>;
    return { status, version: typeof released.version === 'string' ? released.version : version };
  }

  /** Submit for review (DeveloperAppController.php:72). */
  async submitApp(app: string): Promise<{ review_status: string; version: string | null }> {
    const { data } = await this.vendor<Record<string, unknown>>('POST', `/apps/${encodeURIComponent(app)}/submit`, `submitting '${app}'`);
    const submitted = (data.submitted_version ?? null) as Record<string, unknown> | null;
    return {
      review_status: submitted !== null ? (submitted.review_status as string) : (data.review_status as string),
      version: submitted !== null ? (submitted.version as string) : null,
    };
  }
}

function tokenPairOf(body: unknown, status: number): TokenPair {
  const record = body as Record<string, unknown>;
  if (typeof record.access_token !== 'string' || typeof record.refresh_token !== 'string') {
    throw new ApiError('The login returned no token pair.', status, body);
  }
  return {
    access_token: record.access_token,
    refresh_token: record.refresh_token,
    expires_in: typeof record.expires_in === 'number' ? record.expires_in : 3600,
    scope: typeof record.scope === 'string' ? record.scope : '',
  };
}
