import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * CLI auth, Shopify parity:
 *
 * - CI (`QUEEK_APP_AUTOMATION_TOKEN`): a per-app App Automation Token minted
 *   on the Developer page. When set it is the Bearer for app commands and no
 *   login is attempted. The server scopes it to one app's reads, deploy,
 *   release and submit — a 401/403 means it is outside that grant (the API
 *   layer words that per call, naming the app; never a dead session, never
 *   a login prompt).
 * - Local (developer session): a person-scoped `developer-cli` token pair
 *   from `queek auth login` (or automatic sign-in when a command needs auth).
 *   The access token lives ~60 minutes; the refresh token rotates it
 *   transparently. Stored in the OS keychain when `keytar` is installed,
 *   otherwise a 0600 file. Never a merchant key, never pasted.
 */

export const ENV_AUTOMATION_TOKEN = 'QUEEK_APP_AUTOMATION_TOKEN';
export const ENV_API_BASE = 'QUEEK_API_BASE';

/**
 * The backend host serving BOTH routers: vendor API at
 * `{base}/api/v1/biz/...` and OAuth at `{base}/oauth/...`
 * (bootstrap/app.php:86 prefix `api` + routes/api.php `v1/` group +
 * vendor-api.php `v1/biz/` group; web.php `oauth` prefix on the web router).
 */
export const DEFAULT_API_BASE = 'https://api.usequeek.com';

const KEYCHAIN_SERVICE = 'queek-cli';
const KEYCHAIN_ACCOUNT = 'developer-cli-session';

/** Refresh 60s before the access token dies, so a deploy never straddles expiry. */
export const REFRESH_SKEW_MS = 60_000;

export interface CliSession {
  access_token: string;
  refresh_token: string;
  /** Epoch ms when the access token expires (from `expires_in`). */
  expires_at: number;
  scope: string;
}

export function apiBase(): string {
  return (process.env[ENV_API_BASE] ?? DEFAULT_API_BASE).replace(/\/+$/, '');
}

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, 'queek') : join(homedir(), '.config', 'queek');
}

function sessionFile(): string {
  return join(configDir(), 'session.json');
}

interface Keytar {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
}

async function loadKeytar(): Promise<Keytar | null> {
  try {
    // Optional: OS keychain when the host installed it, file fallback
    // otherwise (CI, minimal containers). Never a hard dependency — keytar
    // ships native code that must not gate `npm install -g @usequeek/cli`.
    return (await import('keytar')) as unknown as Keytar;
  } catch {
    return null;
  }
}

/** The CI automation token, or undefined on a developer machine. */
export function automationToken(): string | undefined {
  const value = process.env[ENV_AUTOMATION_TOKEN];
  return value !== undefined && value.trim() !== '' ? value.trim() : undefined;
}

function parseSession(raw: string): CliSession | null {
  try {
    const parsed = JSON.parse(raw) as Partial<CliSession>;
    if (typeof parsed.access_token !== 'string' || parsed.access_token === '') return null;
    if (typeof parsed.refresh_token !== 'string' || parsed.refresh_token === '') return null;
    if (typeof parsed.expires_at !== 'number') return null;
    return { access_token: parsed.access_token, refresh_token: parsed.refresh_token, expires_at: parsed.expires_at, scope: typeof parsed.scope === 'string' ? parsed.scope : '' };
  } catch {
    return null;
  }
}

export async function readSession(): Promise<{ session: CliSession; source: 'keychain' | 'file' } | null> {
  const keytar = await loadKeytar();
  if (keytar) {
    const stored = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    if (stored) {
      const session = parseSession(stored);
      if (session) return { session, source: 'keychain' };
    }
  }
  const file = sessionFile();
  if (existsSync(file)) {
    const session = parseSession(readFileSync(file, 'utf8'));
    if (session) return { session, source: 'file' };
  }
  return null;
}

/** Save a session; returns where it went (for the login receipt). */
export async function writeSession(session: CliSession): Promise<'keychain' | 'file'> {
  const raw = JSON.stringify(session);
  const keytar = await loadKeytar();
  if (keytar) {
    await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, raw);
    return 'keychain';
  }
  const file = sessionFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(session, null, 2)}\n`);
  chmodSync(file, 0o600);
  return 'file';
}

export async function clearSession(): Promise<{ cleared: ('keychain' | 'file')[]; automationSet: boolean }> {
  const cleared: ('keychain' | 'file')[] = [];
  const keytar = await loadKeytar();
  if (keytar && (await keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT))) cleared.push('keychain');
  const file = sessionFile();
  if (existsSync(file)) {
    rmSync(file);
    cleared.push('file');
  }
  return { cleared, automationSet: automationToken() !== undefined };
}

/** True when the access token is dead or dies within the skew window. */
export function sessionExpired(session: CliSession, now = Date.now()): boolean {
  return session.expires_at - REFRESH_SKEW_MS <= now;
}

export function sessionFromPair(pair: { access_token: string; refresh_token: string; expires_in: number; scope?: unknown }): CliSession {
  return {
    access_token: pair.access_token,
    refresh_token: pair.refresh_token,
    expires_at: Date.now() + Math.max(0, pair.expires_in) * 1000,
    scope: typeof pair.scope === 'string' ? pair.scope : '',
  };
}
