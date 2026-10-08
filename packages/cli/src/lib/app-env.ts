import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError, AutomationTokenError, type DeveloperApi } from './app-api.js';

/**
 * `.env`-shaped files for `queek app dev`: the project's own `.env` (read)
 * and `.queek/.env.local` (read + write, 0600, never printed).
 *
 * A documented subset — `KEY=value`, `export KEY=value`, `#` comments,
 * single/double-quoted values, no interpolation or multiline values. Values
 * pass through raw. That covers every machine-managed file the CLI writes
 * and the plain project files it reads; anything fancier belongs to the
 * app's own loader, not the CLI.
 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = (match[2] ?? '').trim();
    const quoted = (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
      || (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
    if (quoted) {
      const inner = value.slice(1, -1);
      value = value.startsWith('"') ? inner.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner;
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trimEnd();
    }
    out[match[1] as string] = value;
  }
  return out;
}

/** Read an env file, or `{}` when it does not exist. */
export function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return parseDotEnv(readFileSync(path, 'utf8'));
}

const LOCAL_FILE = '.env.local';

/**
 * Merge `values` into `.queek/.env.local` (created 0600, kept 0600):
 * existing keys the caller does not name are left alone, named keys are
 * replaced. Callers never log the values — the path is the receipt.
 */
export function writeEnvLocal(dir: string, values: Record<string, string>): string {
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/${LOCAL_FILE}`;
  const current = readEnvFile(file);
  const lines = Object.entries({ ...current, ...values }).map(([key, value]) => `${key}=${value}`);
  writeFileSync(file, `${lines.join('\n')}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // Best effort (Windows has no Unix modes); the content is what matters.
  }
  return file;
}

/** Render one-line base64 for storage (PEM → single line for APP_PRIVATE_KEY). */
export function toOneLineBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

/** Absolute path of the local-only env file (handy for messages). */
export function envLocalPath(queekDirPath: string): string {
  return `${queekDirPath}/${LOCAL_FILE}`;
}

/**
 * `.queek/` holds local-only state (`.env.local`, `codegen.json`,
 * `cloudflared.log`) that must never be committed — but init/dev/deploy
 * only *said* "gitignored" without ensuring it. Every command that creates
 * `.queek/` calls this: a `.gitignore` lacking a `.queek/` line gets one
 * appended; with no `.gitignore` at all one is created (inside or outside
 * a git repo — harmless either way). Never duplicates the line.
 */
export function ensureQueekIgnored(projectDir: string): void {
  const file = join(projectDir, '.gitignore');
  let existing: string | null = null;
  try {
    existing = readFileSync(file, 'utf8');
  } catch {
    writeFileSync(file, '.queek/\n');
    return;
  }
  if (existing.split('\n').some((line) => line.trim() === '.queek/')) return;
  const prefix = existing === '' || existing.endsWith('\n') ? '' : '\n';
  writeFileSync(file, `${existing}${prefix}.queek/\n`);
}

/** Keys the CLI owns in the spawned app's env: project `.env` values for these never win. */
export const OWNED_ENV_KEYS = [
  'APP_BASE_URL',
  'PORT',
  'NODE_ENV',
  'QUEEK_API_BASE',
  'QUEEK_APP_SECRET',
  'APP_KEY_ID',
  'APP_PRIVATE_KEY',
  'APP_ENCRYPTION_KEY',
] as const;

export interface DevSecrets {
  values: Record<string, string>;
  /** Names the caller should persist (the ones that were missing). */
  generated: string[];
}

/** A missing signing secret: exit 2 with the recovery message, never a rotation. */
export class MissingSecretError extends Error {}

/** The one recovery message, shared by the dev gate and the secrets resolver. */
export const MISSING_SECRET_MESSAGE =
  'Missing QUEEK_APP_SECRET and it could not be fetched for this app. Reveal it on the dashboard (Developers → your app → Credentials → Reveal) and put it into .queek/.env.local — or develop against a separate development app: create queek.app.development.toml with its own slug and run `queek app dev -c development`.';

/**
 * The dev-time signing secret, in precedence order: `.queek/.env.local`
 * first, then the environment (used as-is, never written back), then the
 * owner's re-view — GET signing-secret over the signed-in developer's
 * session, merged into `.queek/.env.local` (0600) so the next run finds
 * it. Never a rotation: dev and production share one app record.
 * Automation tokens never reach here (`queek app dev` refuses them first);
 * an automation refusal passes through untouched so it keeps its own
 * wording, while a failed fetch (404/403/network) reads as
 * MissingSecretError with the dashboard-Reveal recovery message.
 * Nothing logged carries the value — the file path is the receipt.
 */
export async function resolveDevSecret(
  api: DeveloperApi,
  slug: string,
  queek: string,
  local: Record<string, string>,
  envSecret: string | undefined,
  log: (line: string) => void,
): Promise<void> {
  if (typeof local.QUEEK_APP_SECRET === 'string' && local.QUEEK_APP_SECRET !== '') return;
  if (typeof envSecret === 'string' && envSecret !== '') return;
  let secret: string;
  try {
    secret = (await api.appSigningSecret(slug)).secret;
  } catch (error) {
    if (error instanceof AutomationTokenError) throw error;
    if (error instanceof ApiError) throw new MissingSecretError(MISSING_SECRET_MESSAGE);
    throw error;
  }
  writeEnvLocal(queek, { QUEEK_APP_SECRET: secret });
  log(`Fetched the signing secret into ${envLocalPath(queek)} (gitignored, 0600 — values are never printed).`);
}

/** The app record holds at most this many keys — minting past it stops, it never fails mid-flow. */
export const MAX_APP_KEYS = 3;

/**
 * The three credentials a dev app needs, from `.queek/.env.local` (or the
 * environment for the secret) when present, minted otherwise (the caller
 * persists `generated` and never prints the values):
 * - signing secret: NEVER rotated here — dev and production share one app
 *   record, so rotating would break every live install. Absent everywhere
 *   reads as MissingSecretError (exit 2, with the recovery message);
 * - keypair: `keys/generate` once, additive (the PEM is returned once;
 *   without the private half a recorded kid is useless, so a partial pair
 *   regenerates). A full keyring stops with a clear message;
 * - encryption key: 32 local random bytes (no server round-trip needed).
 */
export async function ensureDevSecrets(
  api: DeveloperApi,
  app: string,
  local: Record<string, string>,
  existingKids: string[],
  log: (line: string) => void,
  envSecret?: string,
): Promise<DevSecrets> {
  const values: Record<string, string> = {};
  const generated: string[] = [];

  const secret = local.QUEEK_APP_SECRET;
  if (typeof secret === 'string' && secret !== '') {
    values.QUEEK_APP_SECRET = secret;
  } else if (typeof envSecret === 'string' && envSecret !== '') {
    values.QUEEK_APP_SECRET = envSecret;
  } else {
    throw new MissingSecretError(MISSING_SECRET_MESSAGE);
  }

  const kid = local.APP_KEY_ID;
  const privateKey = local.APP_PRIVATE_KEY;
  if (typeof kid === 'string' && kid !== '' && typeof privateKey === 'string' && privateKey !== '') {
    values.APP_KEY_ID = kid;
    values.APP_PRIVATE_KEY = privateKey;
  } else {
    if (existingKids.length >= MAX_APP_KEYS) {
      throw new Error(
        `This app already has ${MAX_APP_KEYS} keys (the maximum) — delete one on the Developer page (your app → Keys), or copy an existing private key into .queek/.env.local as APP_PRIVATE_KEY with its APP_KEY_ID.`,
      );
    }
    log('No keypair in .queek/.env.local — generating one (the private key is shown once, by the API, and stored here).');
    const pair = await api.generateAppKey(app);
    values.APP_KEY_ID = pair.kid;
    values.APP_PRIVATE_KEY = toOneLineBase64(pair.privateKey);
    generated.push('APP_KEY_ID', 'APP_PRIVATE_KEY');
  }

  const encryptionKey = local.APP_ENCRYPTION_KEY;
  if (typeof encryptionKey === 'string' && encryptionKey !== '') {
    values.APP_ENCRYPTION_KEY = encryptionKey;
  } else {
    values.APP_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    generated.push('APP_ENCRYPTION_KEY');
  }
  return { values, generated };
}
