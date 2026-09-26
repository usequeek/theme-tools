/**
 * The live business vocabulary: one resolver, one cache, shared by
 * theme-check, theme-cli and create-theme.
 *
 * Production serves `{ status, data }` at VOCABULARY_URL, where `data` holds
 * the vocabulary (`version`, `services`, `catalogue`, `subcategories`,
 * `root_service`, `labels`). The cache lives under vocabularyCacheDir() and
 * holds the last good `data` with its version. Reads never throw for `live`
 * (they fall back to the cache, then the bundled snapshot, with a one-line
 * notice); only an explicitly pinned `file` that cannot be read or validated
 * throws.
 *
 * Production weakens the ETag to `W/"<v>-br"` (backend 216e0df3 pending), so
 * the conditional GET is built from the stored version, never the raw header:
 * `If-None-Match: "<version>"` (quoted, no `W/`, no suffix).
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import bundled from './utils/business-vocabulary.json' with { type: 'json' };

/** Where the live vocabulary is fetched from. */
export const VOCABULARY_URL = 'https://api.usequeek.com/api/v1/client/theme-vocabulary';

/** A cached copy younger than this is used without a network request (the endpoint sends `Cache-Control: public, max-age=3600`). */
export const VOCABULARY_CACHE_TTL_MS = 3_600_000;

/** The file in the cache dir holding the last good vocabulary. */
const CACHE_FILE = 'vocabulary.json';

export type VocabularySource = 'live' | 'cache' | 'bundled' | 'file';

/** The vocabulary itself: the endpoint's `data`, the bundled JSON, or a pinned file. */
export interface BusinessVocabularyData {
  version?: string;
  services: string[];
  catalogue: Record<string, string[]>;
  subcategories: Record<string, string[]>;
  root_service?: Record<string, string>;
  labels?: Record<string, string>;
}

export interface ResolveVocabularyOptions {
  /** `live` (default) refreshes through the cache; `offline` uses the bundled snapshot, no network. */
  mode?: 'live' | 'offline';
  /** A pinned vocabulary file: wins over everything, and is validated. */
  file?: string;
  /** Ignore a fresh cache, but still revalidate with `If-None-Match`. Queek's submission step uses it. */
  force?: boolean;
  /** Fetch timeout in ms. A timeout falls back like any network error. */
  timeoutMs?: number;
  /** Injectable fetch, for tests. Defaults to the global fetch at call time. */
  fetch?: typeof fetch;
  /** Injectable cache dir, for tests. Defaults to vocabularyCacheDir(). */
  cacheDir?: string;
  /** Injectable clock, for tests. Defaults to Date.now(). */
  now?: number;
}

export interface ResolvedVocabulary {
  vocabulary: BusinessVocabularyData;
  source: VocabularySource;
  version: string;
  /** One line explaining a fallback (cache/bundled used because live failed). Absent on a clean resolve. */
  notice?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isStringArrayMap = (value: unknown): value is Record<string, string[]> =>
  isRecord(value) && Object.values(value).every(isStringArray);

const isStringMap = (value: unknown): value is Record<string, string> =>
  isRecord(value) && Object.values(value).every((item) => typeof item === 'string');

/**
 * The vocabulary's shape, strictly: non-empty service slugs, catalogue roots
 * to branch lists, branches to children. `version` is required when it must
 * identify the copy (endpoint payloads, the cache); a pinned file may omit it.
 */
export function parseVocabularyData(value: unknown, options: { requireVersion: boolean }): BusinessVocabularyData {
  if (!isRecord(value)) throw new Error('the vocabulary is not an object');
  const { version, services, catalogue, subcategories, root_service: rootService, labels } = value;
  if (options.requireVersion && (typeof version !== 'string' || version.length === 0)) {
    throw new Error('the vocabulary has no version');
  }
  if (version !== undefined && typeof version !== 'string') throw new Error('the vocabulary version is not a string');
  if (!isStringArray(services) || services.length === 0 || services.some((slug) => slug.length === 0)) {
    throw new Error('the vocabulary has no services list');
  }
  if (!isStringArrayMap(catalogue)) throw new Error('the vocabulary has no catalogue map');
  if (!isStringArrayMap(subcategories)) throw new Error('the vocabulary has no subcategories map');
  if (rootService !== undefined && !isStringMap(rootService)) throw new Error('the vocabulary root_service is not a map');
  if (labels !== undefined && !isStringMap(labels)) throw new Error('the vocabulary labels are not a map');
  return { version, services, catalogue, subcategories, root_service: rootService, labels };
}

/** The endpoint's `{ status, data }` envelope, unwrapped and strictly validated. */
export function parseEndpointPayload(value: unknown): BusinessVocabularyData {
  if (!isRecord(value) || !isRecord(value.data)) throw new Error('the vocabulary endpoint did not return { status, data }');
  return parseVocabularyData(value.data, { requireVersion: true });
}

/** The bundled snapshot, as data. Its version comes from the synced file. */
export function bundledVocabulary(): BusinessVocabularyData {
  return parseVocabularyData(bundled as unknown, { requireVersion: true });
}

/** The bundled snapshot's version (the synced S1 snapshot). */
export function bundledVersion(): string {
  return (bundled as { version: string }).version;
}

export function vocabularyCacheDir(
  options: { env?: NodeJS.ProcessEnv; platform?: NodeJS.Platform } = {},
): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    const base = env.LOCALAPPDATA;
    if (typeof base === 'string' && base.length > 0) return join(base, 'usequeek');
  }
  if (platform === 'darwin') return join(homedir(), 'Library', 'Caches', 'usequeek');
  const xdg = env.XDG_CACHE_HOME;
  if (typeof xdg === 'string' && xdg.length > 0) return join(xdg, 'usequeek');
  return join(homedir(), '.cache', 'usequeek');
}

interface CacheEntry {
  version: string;
  fetchedAt: number;
  vocabulary: BusinessVocabularyData;
}

function readCache(dir: string): CacheEntry | null {
  let raw: string;
  try {
    raw = readFileSync(join(dir, CACHE_FILE), 'utf8');
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    // The envelope this resolver writes; a raw vocabulary (hand-placed) is
    // accepted too, but counts as stale so it is revalidated.
    if (isRecord(parsed) && typeof parsed.fetchedAt === 'number' && parsed.vocabulary !== undefined) {
      const vocabulary = parseVocabularyData(parsed.vocabulary, { requireVersion: true });
      if (typeof parsed.version !== 'string' || parsed.version !== vocabulary.version) return null;
      return { version: vocabulary.version, fetchedAt: parsed.fetchedAt, vocabulary };
    }
    const vocabulary = parseVocabularyData(parsed, { requireVersion: true });
    return { version: vocabulary.version as string, fetchedAt: 0, vocabulary };
  } catch {
    return null;
  }
}

/** The cached copy, synchronously, for prompts that must ask before any fetch returns. Null when absent or invalid. */
export function readCachedVocabulary(cacheDir?: string): BusinessVocabularyData | null {
  try {
    return readCache(cacheDir ?? vocabularyCacheDir())?.vocabulary ?? null;
  } catch {
    return null;
  }
}

/** Write the cache atomically (temp file + rename), so a crash never leaves half a vocabulary. */
function writeCache(dir: string, vocabulary: BusinessVocabularyData, now: number): void {
  mkdirSync(dir, { recursive: true });
  const entry: CacheEntry = { version: vocabulary.version as string, fetchedAt: now, vocabulary };
  const staging = join(dir, `.${CACHE_FILE}.${process.pid}.tmp`);
  writeFileSync(staging, `${JSON.stringify(entry, null, 2)}\n`);
  renameSync(staging, join(dir, CACHE_FILE));
}

type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

/** Fetch with a timeout that also aborts the request (an injected fake that ignores the signal still loses the race). */
async function fetchWithTimeout(fetchImpl: FetchImpl, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      fetchImpl(url, { ...init, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

const cacheNotice = (version: string, reason: string): string =>
  `theme vocabulary: using the cached copy (version ${version}) — live refresh failed (${reason}).`;

const bundledNotice = (reason: string): string =>
  `theme vocabulary: using the bundled copy (version ${bundledVersion()}) — ${reason}.`;

/**
 * Resolve the vocabulary regulators and prompts check against.
 *
 * - `file` wins, and is validated (an unreadable or invalid file throws).
 * - `offline` uses the bundled snapshot, with no network and no cache read.
 * - `live` uses a fresh cache as-is, else a conditional GET with
 *   `If-None-Match: "<cached version>"`: 304 keeps the cache, 200 validates,
 *   caches atomically, and uses the fresh copy.
 * - A network error, timeout, unexpected status or bad payload falls back to
 *   the cache, else the bundled snapshot, with a one-line `notice`.
 * - `force` skips the fresh-cache shortcut but still sends `If-None-Match`.
 */
export async function resolveVocabulary(options: ResolveVocabularyOptions = {}): Promise<ResolvedVocabulary> {
  const { mode = 'live', file, force = false, timeoutMs = 4000, now = Date.now() } = options;

  if (file !== undefined) {
    let raw: string;
    try {
      raw = readFileSync(resolve(file), 'utf8');
    } catch (error) {
      throw new Error(`cannot read --vocabulary ${file} (${(error as Error).message})`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`--vocabulary ${file} is not valid JSON`);
    }
    const vocabulary =
      isRecord(parsed) && parsed.data !== undefined
        ? parseEndpointPayload(parsed)
        : parseVocabularyData(parsed, { requireVersion: false });
    return { vocabulary, source: 'file', version: vocabulary.version ?? 'unknown' };
  }

  if (mode === 'offline') {
    const vocabulary = bundledVocabulary();
    return { vocabulary, source: 'bundled', version: vocabulary.version as string };
  }

  const dir = options.cacheDir ?? vocabularyCacheDir();
  const cached = readCache(dir);
  if (cached && !force && now - cached.fetchedAt < VOCABULARY_CACHE_TTL_MS) {
    return { vocabulary: cached.vocabulary, source: 'cache', version: cached.version };
  }

  const fetchImpl = (options.fetch ?? globalThis.fetch) as FetchImpl;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (cached) headers['If-None-Match'] = `"${cached.version}"`;
  const fallback = (reason: string): ResolvedVocabulary => {
    if (cached) return { vocabulary: cached.vocabulary, source: 'cache', version: cached.version, notice: cacheNotice(cached.version, reason) };
    const vocabulary = bundledVocabulary();
    return { vocabulary, source: 'bundled', version: vocabulary.version as string, notice: bundledNotice(reason) };
  };

  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, VOCABULARY_URL, { headers }, timeoutMs);
  } catch (error) {
    return fallback(error instanceof Error ? error.message : String(error));
  }

  if (response.status === 304) {
    if (!cached) {
      // No copy to keep: a 304 with nothing cached is a server surprise, not a vocabulary.
      const vocabulary = bundledVocabulary();
      return { vocabulary, source: 'bundled', version: vocabulary.version as string, notice: bundledNotice('the server sent 304 with nothing cached') };
    }
    try {
      writeCache(dir, cached.vocabulary, now);
    } catch {
      // The copy in hand is what matters; a timestamp refresh that fails is not a failure.
    }
    return { vocabulary: cached.vocabulary, source: 'cache', version: cached.version };
  }

  if (response.status !== 200) {
    return fallback(`the server sent ${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return fallback('the response was not JSON');
  }
  let vocabulary: BusinessVocabularyData;
  try {
    vocabulary = parseEndpointPayload(payload);
  } catch (error) {
    return fallback(`the payload was invalid (${(error as Error).message})`);
  }
  try {
    writeCache(dir, vocabulary, now);
  } catch (error) {
    return { vocabulary, source: 'live', version: vocabulary.version as string, notice: `theme vocabulary: fetched live (version ${vocabulary.version as string}) but the cache could not be written (${(error as Error).message}).` };
  }
  return { vocabulary, source: 'live', version: vocabulary.version as string };
}
