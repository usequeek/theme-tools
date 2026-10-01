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

/** A 401/403 under an automation token: wrong app or beyond its grant (never a dead session). */
export class AutomationTokenError extends ApiError {}

/** The session is gone (refresh refused): the user must log in again. */
export class LoginNeededError extends Error {}

/** The dashboard user denied the device approval (RFC 8628 §3.5 access_denied). */
export class DeniedError extends ApiError {}

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
  /** Internal id (lets the dashboard switch into the store). */
  id: number;
  p_id: number;
  name: string;
  slug: string;
  /** The store's public URL (verified custom domain wins) — served, never constructed here. */
  storefront_url: string | null;
}

/**
 * A developer-owned dev store (S-A contract): `is_test` plus the
 * `is_dev_store` flag, standalone (`test_of_vendor_id` NULL) — never a mode
 * of a merchant's live store. The preview URL is built from `admin_url`,
 * served here, never constructed in commands.
 */
export interface DevStore {
  id: number;
  p_id: number;
  name: string;
  slug: string;
  storefront_url: string | null;
  admin_url: string | null;
  created_at: string | null;
  /**
   * Shareable dev storefront password (R1: re-viewable by the owner, NOT a
   * credential key). Carried on GET rows for the owner and on the POST 201 —
   * the backend never resends a lost one outside these payloads. Displayed
   * on stdout only (ready block / info / after creation); never in debug
   * output, and never logged.
   */
  storefront_password?: string;
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
  status: 'released' | 'in_review' | 'created';
  /** True when the manifest was identical: no version was cut. */
  unchanged: boolean;
  /** Shown ONCE on first registration — never returned again. */
  signing_secret?: string;
}

export interface ReleaseResult {
  /** `released` (serving now) or `in_review` (releases when approved). */
  status: 'released' | 'in_review';
  version: string | null;
  sequence: number | null;
}

/**
 * The gated outcome, behind the backend's explicit-submit switch (default
 * OFF): HTTP 409 `{status:"failed", error_type:"review_required", ...,
 * data:{version, sequence, submission_url}}` — no top-level `code`. A normal
 * outcome, never an ApiError: the version waits in development for
 * `queek app submit`.
 */
export interface ReviewRequired {
  status: 'review_required';
  version: string;
  sequence: number;
  submission_url: string | null;
}

/** One readiness probe (SubmissionCheckService.php `run`). `label`/`message` are the server-written sentences; older servers send neither. */
export interface SubmissionCheck {
  key: string;
  level: string;
  ok: boolean;
  detail: unknown;
  at: string;
  label?: string;
  message?: string | null;
}

/** Attestation block of the checklist (lands in a parallel backend slice — all optional here). */
export interface SubmissionAttestation {
  required: boolean;
  items: Array<{ key: string; text: string }>;
}

/** GET …/versions/{sequence}/submission (DeveloperAppController.php `submission`). */
export interface SubmissionChecklist {
  version: string;
  sequence: number;
  review_status: string;
  checks: SubmissionCheck[];
  review_note?: string | null;
  submitted?: unknown;
  attestation?: SubmissionAttestation;
  thread?: unknown[];
}

/** POST …/versions/{sequence}/submit body (SubmitAppVersionRequest.php rules). */
export interface SubmitBody {
  test_instructions: string;
  screencast_url: string;
  contact_email: string;
  emergency_contact: { email: string; phone?: string };
  acknowledged_warnings: string[];
  attestation?: { items: string[] };
}

/** One per-key submit refusal (SubmitAppVersionRequest / evaluate()). */
export interface SubmitFailure {
  key: string;
  reason: string;
}

/** A thrown API failure, decoded for commands (error_type vs error_code matter). */
export interface ApiFailure {
  status: number;
  message: string;
  errorType?: string;
  errorCode?: string;
  failures: SubmitFailure[];
  data: Record<string, unknown>;
}

/** Pull the gated outcome out of a thrown error, if it is one. */
export function reviewRequiredOf(error: unknown): ReviewRequired | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const body = (error.body ?? {}) as Record<string, unknown>;
  if (body.error_type !== 'review_required') return null;
  const data = (body.data ?? {}) as Record<string, unknown>;
  return {
    status: 'review_required',
    version: typeof data.version === 'string' ? data.version : '',
    sequence: typeof data.sequence === 'number' ? data.sequence : 0,
    submission_url: typeof data.submission_url === 'string' ? data.submission_url : null,
  };
}

/** Decode a thrown submit/release failure for clear command messages. */
export function apiFailureOf(error: unknown): ApiFailure | null {
  if (!(error instanceof ApiError)) return null;
  const body = (error.body ?? {}) as Record<string, unknown>;
  const data = (body.data ?? {}) as Record<string, unknown>;
  const failures = Array.isArray(data.failures)
    ? (data.failures as Array<Record<string, unknown>>).map((row) => ({
        key: typeof row.key === 'string' ? row.key : 'unknown',
        reason: typeof row.reason === 'string' ? row.reason : 'unknown',
      }))
    : [];
  return {
    status: error.status,
    message: error.message,
    ...(typeof body.error_type === 'string' ? { errorType: body.error_type } : {}),
    ...(typeof body.error_code === 'string' ? { errorCode: body.error_code } : {}),
    failures,
    data: data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {},
  };
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
  /** Served when the backend attaches them; the CLI never constructs dashboard/store URLs itself. */
  admin_url?: string;
  storefront_url?: string;
  /** Served preview URL (DevStoreService::previewUrl); the CLI rebuilds it from admin_url+slug only as fallback. */
  preview_url?: string;
}

const VENDOR_PREFIX = '/api/v1/biz/vendor/developer';
const OAUTH_PREFIX = '/oauth';

/**
 * Production Developer dashboard (backend `dashboard_url` default).
 * Staging dashboards are unsupported: every dashboard link assumes
 * production, even under a staging QUEEK_API_BASE, until the backend serves
 * its own dashboard_url to the CLI.
 */
export const DASHBOARD_URL = 'https://dashboard.usequeek.com';

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
   * One vendor call: bearer from the session layer, `{data}` unwrapped.
   * Auth failures never trigger a login here: a user 401 refreshes once and
   * retries; an automation 401/403 means the token is outside its app's
   * grant and is worded as such (with the app slug when the call names one).
   * `action` words the refusal ("deploying", "releasing version 1.2.0 of", ...).
   */
  private async vendor<T>(
    method: string,
    path: string,
    action: string,
    body?: unknown,
    appSlug?: string,
    headers?: Record<string, string>,
  ): Promise<{ data: T; message: string; status: number }> {
    const automationRefusal = (status: number, raw: unknown): AutomationTokenError => {
      const detail = messageOf(raw, status);
      const scope = appSlug ? `it only works for app '${appSlug}'s deploy, versions, release and submit` : 'it only works for its own app';
      return new AutomationTokenError(`This automation token can't do that — ${scope}. (Server: ${detail})`, status, raw);
    };
    const attempt = async (token: string, kind: AuthKind, retried: boolean): Promise<{ data: unknown; message: string; status: number }> => {
      const { status, body: raw } = await this.raw(`${this.base}${VENDOR_PREFIX}${path}`, {
        method,
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${token}`, ...(headers ?? {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      // Scoping moved into Sanctum's token resolution: an automation token
      // outside its app's allowed routes reads as 401, same as a dead
      // developer session — but the two mean opposite things, so they split
      // here and never meet a browser login.
      if (status === 401 && kind === 'automation') throw automationRefusal(status, raw);
      // One transparent refresh-and-retry on 401 (user sessions only): a
      // second 401 throws below instead of looping.
      if (status === 401 && kind === 'user' && !retried && this.onRefresh) {
        const fresh = await this.onRefresh();
        return attempt(fresh, kind, true);
      }
      if (status === 403 && kind === 'automation') throw automationRefusal(status, raw);
      if (status < 200 || status >= 300) throw new ApiError(messageOf(raw, status), status, raw);
      const envelope = (raw ?? {}) as { data?: unknown; message?: unknown };
      return { data: envelope.data ?? null, message: typeof envelope.message === 'string' ? envelope.message : '', status };
    };

    const auth = await this.getAuth();
    const { data, message, status } = await attempt(auth.token, auth.kind, false);
    return { data: data as T, message, status };
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

  /**
   * Poll until approval (AgentOAuthController.php:97): 202 pending → null,
   * 200 → token pair, 403 access_denied → DeniedError (user denied, stop
   * polling), 404 / expired_token → expired message (fetch a fresh code).
   * RFC 8628 §3.5 `slow_down` (usually 400) and the 429 throttle are NOT
   * errors: they report through `onSlowDown` and read as null (keep polling,
   * slower) — the B1 crash was throwing on them.
   */
  async deviceStatus(deviceCode: string, hooks?: { onSlowDown?: (serverIntervalSec?: number) => void }): Promise<TokenPair | null> {
    const { status, body } = await this.raw(`${this.base}${OAUTH_PREFIX}/device/status?code=${encodeURIComponent(deviceCode)}`, {
      headers: { accept: 'application/json' },
    });
    if (status === 202) return null;
    const errorCode = (body as { error?: unknown } | null)?.error;
    if (errorCode === 'slow_down' || status === 429) {
      // The server computes the backoff (slow_down carries `interval`,
      // seconds, like the device-code issue); absent, the caller falls back
      // to +5s per RFC 8628 §3.5.
      const interval = (body as { interval?: unknown } | null)?.interval;
      hooks?.onSlowDown?.(typeof interval === 'number' ? interval : undefined);
      return null;
    }
    if (errorCode === 'access_denied') {
      throw new DeniedError('Sign-in was denied in the dashboard.', status, body);
    }
    if (status === 404 || errorCode === 'expired_token') {
      throw new ApiError('Code expired or already used — run `queek auth login` again.', status, body);
    }
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
   * `cli` client is public (PKCE, no secret), so this succeeds secretless —
   * but logout never depends on it: the caller always clears local creds.
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
   * Deploy: POST /apps `{manifest, version?, message?, no_release?}` →
   * 201 (new app) or 200, never 202. `message` alone: the server treats it
   * as the changelog alias (message wins when both are sent), so one field
   * is enough. Default deploy RELEASES through the release policy (first
   * listing → in_review, harmless N+1 on an approved app → released);
   * `no_release: true` holds the version in development (created). The
   * outcome is `data.status` — never the HTTP code (DeveloperAppController.php:180).
   */
  async deploy(manifest: AppManifest, options: DeployOptions = {}): Promise<DeployResult | ReviewRequired> {
    let data: Record<string, unknown>;
    let message: string;
    let httpStatus: number;
    try {
      const answered = await this.vendor<Record<string, unknown>>(
        'POST',
        '/apps',
        'deploying this app',
        {
          manifest,
          ...(options.version !== undefined ? { version: options.version } : {}),
          ...(options.message !== undefined ? { message: options.message } : {}),
          ...(options.noRelease ? { no_release: true } : {}),
        },
        manifest.slug,
      );
      data = answered.data;
      message = answered.message;
      httpStatus = answered.status;
    } catch (error) {
      // Gated outcome, not a failure: the version waits in development for
      // `queek app submit`. Anything else rethrows.
      const gated = reviewRequiredOf(error);
      if (gated) return gated;
      throw error;
    }
    const version = (data.version ?? {}) as Record<string, unknown>;
    const unchanged = data.unchanged === true || /no changes/i.test(message);
    const reviewStatus = version.review_status as string;
    // The contract guarantees data.status (released|in_review|created):
    // an answer without one is a backend regression, and 'released' would
    // be the most dangerous guess — fail loudly instead.
    if (data.status !== 'released' && data.status !== 'in_review' && data.status !== 'created') {
      throw new ApiError('Unexpected deploy response from Queek — no status (expected released|in_review|created).', httpStatus, data);
    }
    const status = data.status;
    return {
      p_id: data.p_id as string,
      slug: data.slug as string,
      name: data.name as string,
      version: version.version as string,
      sequence: version.sequence as number,
      review_status: reviewStatus,
      status,
      unchanged,
      ...(typeof data.signing_secret === 'string' ? { signing_secret: data.signing_secret } : {}),
    };
  }

  /** One page of owned test stores (DeveloperAppController.php:239). */
  async testStores(page = 1): Promise<{ data: TestStore[]; total: number }> {
    const { data } = await this.vendor<{ data: TestStore[]; meta: { total: number } }>(
      'GET',
      `/test-stores?per_page=50&page=${page}`,
      'listing test stores',
    );
    return { data: data.data, total: data.meta.total };
  }

  /** One page of owned dev stores (DeveloperAppController.php:855). */
  async devStoresPage(page = 1): Promise<{ data: DevStore[]; total: number }> {
    const { data } = await this.vendor<{ data: DevStore[]; meta?: { total?: number } }>(
      'GET',
      `/dev-stores?per_page=50&page=${page}`,
      'listing dev stores',
    );
    const total = typeof data.meta?.total === 'number' ? data.meta.total : data.data.length;
    return { data: data.data, total };
  }

  /** Every owned dev store, across pages (the `--store` selector never strands large owners). */
  async devStores(): Promise<{ data: DevStore[] }> {
    const first = await this.devStoresPage(1);
    const all = [...first.data];
    const pages = Math.ceil(first.total / 50);
    for (let page = 2; page <= pages; page += 1) {
      const next = await this.devStoresPage(page);
      all.push(...next.data);
    }
    return { data: all };
  }

  /**
   * Create a dev store (S-A contract, D1; names R2): POST /dev-stores
   * {name (≤60), slug?, test_data} → 201 the store incl. storefront_password.
   * Slug omitted means the backend default (slugified name + "-dev");
   * taken → 422 with a suggested free slug, surfaced verbatim. The 201's
   * storefront_password is threaded through (never dropped): it is the only
   * copy the backend will show. Idempotency-Key is fresh per creation
   * attempt; a re-run lists first and only creates when still absent —
   * list-then-create is the dedupe, not key reuse.
   */
  async createDevStore(name: string, testData: boolean, idempotencyKey: string, slug?: string): Promise<DevStore> {
    const trimmed = name.trim();
    if (trimmed === '') throw new Error('A dev store needs a name.');
    if (trimmed.length > 60) throw new Error(`Dev store name '${trimmed}' is ${trimmed.length} characters — the dashboard allows 60.`);
    const { data } = await this.vendor<DevStore>(
      'POST',
      '/dev-stores',
      `creating dev store '${trimmed}'`,
      { name: trimmed, ...(slug !== undefined && slug !== '' ? { slug } : {}), test_data: testData },
      undefined,
      { 'Idempotency-Key': idempotencyKey },
    );
    return data;
  }

  /** Every owned test store, across pages (the `--store` selector never strands large owners). */
  async allTestStores(): Promise<{ data: TestStore[]; total: number }> {
    const first = await this.testStores(1);
    const all = [...first.data];
    const pages = Math.ceil(first.total / 50);
    for (let page = 2; page <= pages; page += 1) {
      const next = await this.testStores(page);
      all.push(...next.data);
    }
    return { data: all, total: first.total };
  }

  /** Install an unreviewed dev build on an owned test store (DeveloperAppController.php:268). */
  async devInstall(app: string, testStorePId: number, settings?: Record<string, unknown>): Promise<DevInstallResult> {
    const { data } = await this.vendor<DevInstallResult>(
      'POST',
      `/apps/${encodeURIComponent(app)}/dev-installs`,
      `installing a dev build of '${app}'`,
      {
        test_store_p_id: testStorePId,
        ...(settings !== undefined ? { settings } : {}),
      },
      app,
    );
    return data;
  }

  /** Server → toml (DeveloperAppController.php:308). */
  async appConfig(app: string): Promise<AppConfig> {
    const { data } = await this.vendor<AppConfig>('GET', `/apps/${encodeURIComponent(app)}/config`, `linking config of '${app}'`, undefined, app);
    return data;
  }

  /** Every version snapshot, newest first (DeveloperAppController.php:342). */
  async appVersions(app: string): Promise<{ versions: AppVersion[] }> {
    const { data: rows } = await this.vendor<Record<string, unknown>[]>(
      'GET',
      `/apps/${encodeURIComponent(app)}/versions`,
      `listing versions of '${app}'`,
      undefined,
      app,
    );
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

  /**
   * Serve a created version: released now, or held in review (review-policy
   * §116). The route takes the version SEQUENCE (ReleaseVersionRequest
   * ctype_digit gate — a semver reads as 404): a semver input is resolved
   * via the versions list first. Unknown input errors listing what exists.
   */
  async releaseVersion(app: string, input: string): Promise<ReleaseResult | ReviewRequired> {
    let sequence: number;
    if (/^\d+$/.test(input)) {
      sequence = Number(input);
    } else {
      const { versions } = await this.appVersions(app);
      const found = versions.find((row) => row.version === input);
      if (!found) {
        throw new Error(
          `Unknown version '${input}' for '${app}'. Available: ${versions.map((row) => row.version).join(', ') || 'none yet — `queek app deploy` cuts the first one'}.`,
        );
      }
      sequence = found.sequence;
    }
    let data: Record<string, unknown>;
    try {
      data = (
        await this.vendor<Record<string, unknown>>(
          'POST',
          `/apps/${encodeURIComponent(app)}/versions/${sequence}/release`,
          `releasing version ${input} of '${app}'`,
          undefined,
          app,
        )
      ).data;
    } catch (error) {
      const gated = reviewRequiredOf(error);
      if (gated) return gated;
      throw error;
    }
    const status: 'released' | 'in_review' = data.status === 'in_review' ? 'in_review' : 'released';
    return {
      status,
      version: typeof data.version === 'string' ? data.version : input,
      sequence: typeof data.sequence === 'number' ? data.sequence : sequence,
    };
  }

  /**
   * Mint a keypair for the app (DeveloperAppKeyController.php `generate`):
   * POST …/keys/generate → 201 `data.{kid, added_at, private_key}`. The
   * private PEM is shown ONCE — a replayed request answers `private_key:
   * null`, which reads as an error here (generate again instead).
   */
  async generateAppKey(app: string): Promise<{ kid: string; privateKey: string }> {
    const { data } = await this.vendor<Record<string, unknown>>('POST', `/apps/${encodeURIComponent(app)}/keys/generate`, `generating a key for '${app}'`, {}, app);
    if (typeof data.kid !== 'string' || typeof data.private_key !== 'string' || data.private_key === '') {
      throw new ApiError(`Key generation for '${app}' returned no private key — it was already shown once; generate a new key if it was lost.`, 200, data);
    }
    return { kid: data.kid, privateKey: data.private_key };
  }

  /**
   * The app's recorded public keys (DeveloperAppKeyController.php `index`):
   * GET …/keys → `data.keys: [{kid, added_at}]`. `queek app dev` reads this
   * before minting so a full keyring stops with a clear message instead of
   * failing mid-flow. There is deliberately no rotate-secret wrapper: dev
   * and production share one app record, so rotation is never automatic.
   */
  async appKeys(app: string): Promise<{ kids: string[] }> {
    const { data } = await this.vendor<{ keys: Array<{ kid: string }> }>('GET', `/apps/${encodeURIComponent(app)}/keys`, `listing keys of '${app}'`, undefined, app);
    return { kids: data.keys.map((row) => row.kid) };
  }

  /**
   * Owner-only secret re-view (DeveloperAppKeyController.php `showSecret`):
   * GET …/signing-secret → `data.{signing_secret, previous_expires_at?}`.
   * Read over the signed-in developer's session — an automation token 401s
   * here by backend design (AutomationTokenError, never retried), so
   * `queek app dev` refuses those before calling this. There is
   * deliberately no rotate wrapper: dev and production share one app
   * record, so rotation is never automatic.
   */
  async appSigningSecret(app: string): Promise<{ secret: string; previousExpiresAt: string | null }> {
    const { data } = await this.vendor<Record<string, unknown>>(
      'GET',
      `/apps/${encodeURIComponent(app)}/signing-secret`,
      `reading the signing secret of '${app}'`,
      undefined,
      app,
    );
    if (typeof data.signing_secret !== 'string' || data.signing_secret === '') {
      throw new ApiError(`The signing secret of '${app}' was not returned — reveal it on the Developer page (your app → Credentials → Reveal).`, 200, data);
    }
    return {
      secret: data.signing_secret,
      previousExpiresAt: typeof data.previous_expires_at === 'string' ? data.previous_expires_at : null,
    };
  }

  /**
   * Readiness checklist for one owned version (DeveloperAppController.php
   * `submission`): stored checks return with zero egress when fresh,
   * otherwise the server re-probes. `review_note`/`submitted`/`attestation`/
   * `thread` are read by exact name and defaulted when absent.
   */
  async submission(app: string, sequence: number): Promise<SubmissionChecklist> {
    const { data } = await this.vendor<Record<string, unknown>>(
      'GET',
      `/apps/${encodeURIComponent(app)}/versions/${sequence}/submission`,
      `reading the submission checklist of '${app}' sequence ${sequence}`,
      undefined,
      app,
    );
    const attestation = (data.attestation ?? null) as Record<string, unknown> | null;
    return {
      version: typeof data.version === 'string' ? data.version : '',
      sequence: typeof data.sequence === 'number' ? data.sequence : sequence,
      review_status: typeof data.review_status === 'string' ? data.review_status : 'development',
      checks: (Array.isArray(data.checks) ? data.checks : []).map((row) => {
        const check = (row ?? {}) as Record<string, unknown>;
        return {
          key: typeof check.key === 'string' ? check.key : 'unknown',
          level: typeof check.level === 'string' ? check.level : 'error',
          ok: check.ok === true,
          detail: check.detail ?? null,
          at: typeof check.at === 'string' ? check.at : '',
          ...(typeof check.label === 'string' && check.label !== '' ? { label: check.label } : {}),
          ...(typeof check.message === 'string' && check.message !== '' ? { message: check.message } : {}),
        };
      }),
      ...(typeof data.review_note === 'string' ? { review_note: data.review_note } : {}),
      ...('submitted' in data ? { submitted: data.submitted } : {}),
      ...(attestation !== null
        ? {
            attestation: {
              required: attestation.required === true,
              items: (Array.isArray(attestation.items) ? attestation.items : []).map((entry) => {
                const item = (entry ?? {}) as Record<string, unknown>;
                return { key: typeof item.key === 'string' ? item.key : '', text: typeof item.text === 'string' ? item.text : '' };
              }),
            },
          }
        : {}),
      ...(Array.isArray(data.thread) ? { thread: data.thread } : {}),
    };
  }

  /**
   * Explicit submit of the `{sequence}` version (DeveloperAppController.php
   * `submitVersion`): 200 `data.submitted_version`. The Idempotency-Key is
   * caller-owned — fresh per logical submit, reused on retry — because a
   * replayed body under the same key answers the stored response while a
   * changed body 409s key-reuse. 409/422/429 propagate as ApiError for the
   * command to word (see apiFailureOf).
   */
  async submitVersion(
    app: string,
    sequence: number,
    body: SubmitBody,
    idempotencyKey: string,
  ): Promise<{ version: string; sequence: number; review_status: string }> {
    const { data } = await this.vendor<Record<string, unknown>>(
      'POST',
      `/apps/${encodeURIComponent(app)}/versions/${sequence}/submit`,
      `submitting '${app}' sequence ${sequence}`,
      body,
      app,
      { 'Idempotency-Key': idempotencyKey },
    );
    const submitted = (data.submitted_version ?? {}) as Record<string, unknown>;
    return {
      version: typeof submitted.version === 'string' ? submitted.version : '',
      sequence: typeof submitted.sequence === 'number' ? submitted.sequence : sequence,
      review_status: typeof submitted.review_status === 'string' ? submitted.review_status : 'in_review',
    };
  }

  /**
   * Withdraw the `{sequence}` version from review (DeveloperAppController.php
   * `withdraw`): in_review → development with the server-written note.
   * 200 `data.withdrawn_version.{version, sequence, review_status,
   * review_note}`.
   */
  async withdrawVersion(
    app: string,
    sequence: number,
  ): Promise<{ version: string; sequence: number; review_status: string; review_note: string | null }> {
    const { data } = await this.vendor<Record<string, unknown>>(
      'POST',
      `/apps/${encodeURIComponent(app)}/versions/${sequence}/withdraw`,
      `withdrawing '${app}' sequence ${sequence}`,
      undefined,
      app,
    );
    const withdrawn = (data.withdrawn_version ?? {}) as Record<string, unknown>;
    return {
      version: typeof withdrawn.version === 'string' ? withdrawn.version : '',
      sequence: typeof withdrawn.sequence === 'number' ? withdrawn.sequence : sequence,
      review_status: typeof withdrawn.review_status === 'string' ? withdrawn.review_status : 'development',
      review_note: typeof withdrawn.review_note === 'string' ? withdrawn.review_note : null,
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
