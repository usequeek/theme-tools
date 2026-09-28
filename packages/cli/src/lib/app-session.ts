import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { DeveloperApi, LoginNeededError, type AuthContext, type TokenPair } from './app-api.js';
import {
  apiBase,
  automationToken,
  readSession,
  sessionExpired,
  sessionFromPair,
  writeSession,
  type CliSession,
} from './app-auth.js';
import { openUrl } from './app-browser.js';

export interface FlowIO {
  log: (line: string) => void;
  logError: (line: string) => void;
  debug: (line: string) => void;
}

const base64url = (buffer: Buffer): string =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Wait for the loopback `?code=` redirect the dashboard approval sends back. */
function waitForCode(port: number, state: string, timeoutMs: number): Promise<{ code: string; redirectUri: string }> {
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', redirectUri);
      if (url.pathname !== '/callback') {
        response.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const returned = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      response.writeHead(200, { 'content-type': 'text/html' }).end(
        '<html><body><p>You are logged in — return to the terminal.</p></body></html>',
      );
      server.close();
      if (returned !== state) reject(new Error('The login reply did not match this attempt (state mismatch) — try again.'));
      else if (typeof code === 'string' && code !== '') resolve({ code, redirectUri });
      else reject(new Error(error ? `The dashboard refused the login (${error}).` : 'The dashboard sent back no code.'));
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1');
    setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for the dashboard approval (5 minutes).'));
    }, timeoutMs).unref();
  });
}

/**
 * Browser login against the reused connector OAuth machinery
 * (routes/web.php:110 `oauth/authorize` → AgentOAuthController.php:33;
 * loopback redirect per RFC 8252, AgentOAuthService.php:580). Returns the
 * saved session's storage for the receipt.
 */
export async function browserLogin(api: DeveloperApi, base: string, io: FlowIO): Promise<'keychain' | 'file'> {
  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Could not bind the loopback login redirect.');
  }
  server.close();
  const port = (address as { port: number }).port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  // Exact authorize shape (AuthorizeRequest.php): client_id, redirect_uri,
  // response_type=code, S256 challenge, scope, state.
  const authorize = new URL(`${base}/oauth/authorize`);
  authorize.searchParams.set('client_id', 'cli');
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('scope', 'developer-cli');
  authorize.searchParams.set('code_challenge', challenge);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('state', state);

  io.log('Opening the browser to approve this login…');
  openUrl(authorize.toString());
  const { code } = await waitForCode(port, state, 5 * 60_000);
  const pair = await api.oauthToken({ code, code_verifier: verifier, redirect_uri: redirectUri });
  const stored = await writeSession(sessionFromPair(pair));
  io.log(`Logged in (session stored in ${stored === 'keychain' ? 'the OS keychain' : 'a 0600 session file'}).`);
  return stored;
}

/**
 * Headless device fallback (routes/web.php:122-123 → AgentOAuthController
 * deviceCode:84 / deviceStatus:97): the dashboard approves the shown
 * user code; the poll returns the token pair once, single-use.
 */
export async function deviceLogin(api: DeveloperApi, io: FlowIO): Promise<'keychain' | 'file'> {
  const issued = await api.deviceCode();
  io.log(`Open ${issued.verification_uri} and enter code:\n\n  ${issued.user_code}\n`);
  const deadline = Date.now() + issued.expires_in * 1000;
  const step = Math.max(1, issued.interval) * 1000;
  for (;;) {
    await new Promise((done) => setTimeout(done, step));
    const pair: TokenPair | null = await api.deviceStatus(issued.device_code).catch((error: Error & { status?: number }) => {
      // Unknown-or-expired codes read as 404 — that ends the wait; anything
      // else is transient and the poll continues.
      if ((error as { status?: number }).status === 404) {
        throw new Error('That code is unknown or expired — run the login again for a fresh one.');
      }
      io.debug(`device poll: ${error.message}`);
      return null;
    });
    if (pair) {
      const stored = await writeSession(sessionFromPair(pair));
      io.log(`Logged in (session stored in ${stored === 'keychain' ? 'the OS keychain' : 'a 0600 session file'}).`);
      return stored;
    }
    if (Date.now() > deadline) throw new Error('The code expired before approval — run the login again for a fresh one.');
  }
}

export interface SessionOptions extends FlowIO {
  /** Skip the browser even when one could open (`--no-browser`). */
  noBrowser: boolean;
}

/**
 * What every authenticated command runs on: the CI automation token untouched
 * (no login ever attempted), otherwise a developer session — refreshed when
 * stale, auto-created by sign-in when missing. Throws LoginNeededError (with
 * the exact next step) when sign-in is impossible here.
 */
export async function resolveSession(options: SessionOptions): Promise<{ api: DeveloperApi; kind: 'automation' | 'user' }> {
  const base = apiBase();
  const auto = automationToken();
  if (auto) {
    options.debug('auth: automation token');
    const api = new DeveloperApi(base, { getAuth: async (): Promise<AuthContext> => ({ token: auto, kind: 'automation' }) });
    return { api, kind: 'automation' };
  }

  const api = new DeveloperApi(base);
  const found = await readSession();
  if (found && !sessionExpired(found.session)) {
    options.debug(`auth: session (${found.source})`);
    return { api: withSession(api, found.session), kind: 'user' };
  }
  if (found) {
    // Stale session: one refresh attempt before falling through to login.
    try {
      const fresh = await refreshSession(api, found.session);
      return { api: withSession(api, fresh), kind: 'user' };
    } catch (error) {
      options.debug(`auth: refresh refused (${(error as Error).message}); signing in.`);
    }
  }
  return signIn(api, base, options);
}

/** Refresh a session in place; throws LoginNeededError when the grant is dead. */
export async function refreshSession(api: DeveloperApi, session: CliSession): Promise<CliSession> {
  let pair: TokenPair;
  try {
    pair = await api.refreshTokens(session.refresh_token);
  } catch (error) {
    throw new LoginNeededError(`The saved session expired and would not refresh (${(error as Error).message}) — run \`queek auth login\` again.`);
  }
  const fresh = sessionFromPair(pair);
  await writeSession(fresh);
  return fresh;
}

function withSession(api: DeveloperApi, initial: CliSession): DeveloperApi {
  let current = initial;
  const getAuth = async (): Promise<AuthContext> => {
    if (sessionExpired(current)) current = await refreshSession(api, current);
    return { token: current.access_token, kind: 'user' };
  };
  return new DeveloperApi(apiBase(), {
    getAuth,
    onRefresh: async (): Promise<string> => {
      current = await refreshSession(api, current);
      return current.access_token;
    },
  });
}

async function signIn(api: DeveloperApi, base: string, options: SessionOptions): Promise<{ api: DeveloperApi; kind: 'user' }> {
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!interactive) {
    throw new LoginNeededError(
      'Not logged in and this shell is not interactive — set QUEEK_APP_AUTOMATION_TOKEN (CI) or run `queek auth login` where a browser opens.',
    );
  }
  const useDevice = options.noBrowser;
  if (!useDevice) {
    try {
      await browserLogin(api, base, options);
    } catch (error) {
      // A browser that cannot open is not a failed login — fall through to
      // the headless flow rather than stranding SSH users.
      options.logError(`Browser login did not complete (${(error as Error).message}); falling back to the device code.`);
      await deviceLogin(api, options);
    }
  } else {
    await deviceLogin(api, options);
  }
  const saved = await readSession();
  if (!saved) throw new LoginNeededError('Sign-in finished but no session was stored — run `queek auth login` again.');
  return { api: withSession(api, saved.session), kind: 'user' };
}
