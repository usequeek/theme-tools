import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Where `queek login` keeps its token: the `QUEEK_CLI_TOKEN` env override
 * wins (CI/SSH), otherwise the OS keychain when `keytar` is installed, else
 * a 0600 file under the config dir. The token is person-scoped
 * (`developer-cli`) — never a merchant key, never pasted from the dashboard.
 */

export const ENV_TOKEN = 'QUEEK_CLI_TOKEN';
export const ENV_API_BASE = 'QUEEK_API_BASE';
export const ENV_DASHBOARD_URL = 'QUEEK_DASHBOARD_URL';

/** Contract assumption A1: the developer API host until the backend names it. */
export const DEFAULT_API_BASE = 'https://api.usequeek.com';
/** Contract assumption A2: the dashboard host the browser login approves on. */
export const DEFAULT_DASHBOARD_URL = 'https://dashboard.usequeek.com';

const KEYCHAIN_SERVICE = 'queek-cli';
const KEYCHAIN_ACCOUNT = 'developer-cli-token';

export function apiBase(): string {
  return (process.env[ENV_API_BASE] ?? DEFAULT_API_BASE).replace(/\/+$/, '');
}

export function dashboardUrl(): string {
  return (process.env[ENV_DASHBOARD_URL] ?? DEFAULT_DASHBOARD_URL).replace(/\/+$/, '');
}

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, 'queek') : join(homedir(), '.config', 'queek');
}

function credentialsFile(): string {
  return join(configDir(), 'credentials.json');
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

/** The env override, or null when the store owns the token. */
export function envToken(): string | undefined {
  const value = process.env[ENV_TOKEN];
  return value !== undefined && value.trim() !== '' ? value.trim() : undefined;
}

export async function readToken(): Promise<{ token: string; source: 'env' | 'keychain' | 'file' } | null> {
  const env = envToken();
  if (env) return { token: env, source: 'env' };

  const keytar = await loadKeytar();
  if (keytar) {
    const stored = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT);
    if (stored) return { token: stored, source: 'keychain' };
  }

  const file = credentialsFile();
  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { token?: unknown };
      if (typeof parsed.token === 'string' && parsed.token !== '') return { token: parsed.token, source: 'file' };
    } catch {
      return null;
    }
  }
  return null;
}

/** Save a token; returns where it went (for the login receipt). */
export async function writeToken(token: string): Promise<'keychain' | 'file'> {
  const keytar = await loadKeytar();
  if (keytar) {
    await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, token);
    return 'keychain';
  }
  const file = credentialsFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ token }, null, 2));
  chmodSync(file, 0o600);
  return 'file';
}

export async function clearToken(): Promise<{ cleared: ('keychain' | 'file')[]; envSet: boolean }> {
  const cleared: ('keychain' | 'file')[] = [];
  const keytar = await loadKeytar();
  if (keytar && (await keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT))) cleared.push('keychain');
  const file = credentialsFile();
  if (existsSync(file)) {
    rmSync(file);
    cleared.push('file');
  }
  return { cleared, envSet: envToken() !== undefined };
}
