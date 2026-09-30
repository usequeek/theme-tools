import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import openapiTS, { astToString, type OpenAPI3 } from 'openapi-typescript';
import { queekDir, resolveTomlPath } from './app-manifest.js';

/**
 * `queek app codegen`: the app-owned Merchant API types, Shopify's
 * `graphql-codegen` shape — a manual step, never part of `dev`.
 *
 * A thin TypeScript port of the SDK's `scripts/gen-merchant-types.mjs`
 * (same pinned spec URL, same sanity check, same `servers` normalize, same
 * openapi-typescript at the same pinned version). A direct import is not
 * possible: the script lives in another repo (`@usequeek/app-sdk`, never a
 * CLI dependency) and the CLI ships the compiled output — so the checks
 * below mirror it constant-for-constant instead of forking it. Coupling
 * note: the SDK pins its `openapi-typescript` independently, so when the
 * SDK bumps its pin, bump the CLI's `dependencies` entry in lockstep —
 * otherwise app-owned output and SDK output can diverge in shape.
 *
 * The recorded pin is the `Spec sha256:` line of the committed
 * `types/merchant.ts` provenance header (review-visible per G3);
 * `.queek/codegen.json` is a local debug aid (`.queek/` is gitignored in
 * apps) that the unchanged check prefers, falling back to the header.
 */

export const MERCHANT_SPEC_URL = 'https://api.usequeek.com/docs/merchant.json';
export const MERCHANT_API_BASE = 'https://api.usequeek.com/api/v1/merchant';
export const EXPECTED_OPENAPI_VERSION = '3.1.0';
export const REQUIRED_SPEC_PATH = '/orders/import';
/** Same timeout as the SDK's `check-merchant-snapshot.mjs` live fetch. */
export const SPEC_FETCH_TIMEOUT_MS = 20_000;

/** The committed generated file inside the app (plan G3: stays diffable). */
export const CODEGEN_TYPES_FILE = join('types', 'merchant.ts');
/**
 * The recorded spec hash. `.queek/` (not the toml): `toManifest` rejects
 * unknown toml keys, so the toml cannot carry it.
 */
export const CODEGEN_RECORD_FILE = 'codegen.json';

/** Refusal (exit 1), unless `exitCode` says otherwise. */
export class CodegenError extends Error {
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

export interface CodegenOk {
  offline: false;
  /**
   * True when the recorded hash already matched: nothing was rewritten, so
   * reruns leave the tree clean.
   */
  unchanged: boolean;
  /** The types file, relative to the app dir (written unless unchanged). */
  file: string;
  /** The record file, relative to the app dir (written unless unchanged). */
  recordFile: string;
  source: string;
  /** sha256 of the exact fetched/read bytes (what B1's `x-queek-spec-sha` hashes). */
  specSha256: string;
  paths: number;
}

export interface CodegenSkipped {
  offline: true;
  /** Why the run kept the existing types (printed as the warning). */
  reason: string;
}

export type CodegenResult = CodegenOk | CodegenSkipped;

/** Structural subset of a fetch Response — fakes only implement this. */
export interface SpecResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type SpecFetch = (url: string, init?: { signal: AbortSignal }) => Promise<SpecResponse>;
export type SpecGenerate = (spec: Record<string, unknown>) => Promise<string>;

/**
 * A Cloudflare/edge error page must never become the committed contract.
 * Sniffs the body (works for file inputs, which have no headers) — the
 * sanity check below only runs on parsed JSON, so HTML would otherwise die
 * as a confusing SyntaxError before it.
 */
export function looksLikeHtml(text: string): boolean {
  return text.replace(/^\uFEFF/, '').trimStart().startsWith('<');
}

export function isHtmlContentType(contentType: string | null): boolean {
  return contentType !== null && contentType.toLowerCase().includes('text/html');
}

/**
 * The SDK's sanity check, verbatim (`gen-merchant-types.mjs:46-51`): the
 * merchant-scoped export (Scramble `--api=merchant` strips the
 * `/api/v1/merchant` prefix, so paths are scope-relative) must carry the
 * import op the SDK depends on.
 */
export function sanityCheckSpec(spec: unknown): asserts spec is Record<string, unknown> & { paths: Record<string, unknown> } {
  const record = spec as Record<string, unknown> | null;
  const paths = record?.paths as Record<string, unknown> | undefined;
  if (record?.openapi !== EXPECTED_OPENAPI_VERSION || typeof paths !== 'object' || paths === null || !(REQUIRED_SPEC_PATH in paths)) {
    throw new CodegenError(
      'Spec sanity check failed: expected OpenAPI 3.1.0 with an /orders/import path (export with `php artisan scramble:export --api=merchant`).',
    );
  }
}

/** The SDK's one-field normalize (`gen-merchant-types.mjs:55`): a local Scramble export points `servers` at localhost. */
export function normalizeSpec(spec: Record<string, unknown>): Record<string, unknown> {
  return { ...spec, servers: [{ url: MERCHANT_API_BASE, description: 'Current' }] };
}

/** sha256 of the exact served bytes — the same input B1 hashes for `x-queek-spec-sha`. */
export function specSha256(specText: string): string {
  return createHash('sha256').update(specText, 'utf8').digest('hex');
}

/** Parse a fetched/read body, refusing HTML with the loud contract message (never a bare SyntaxError). */
export function parseSpecText(specText: string, source: string): unknown {
  if (looksLikeHtml(specText)) {
    throw new CodegenError(
      `Refused HTML from ${source} — expected the Merchant OpenAPI spec, got an error page (login wall or edge 5xx). Fix the backend/edge, then run \`queek app codegen\` again.`,
    );
  }
  try {
    return JSON.parse(specText);
  } catch {
    throw new CodegenError(`The Merchant spec from ${source} did not parse as JSON — refusing to write types from it.`);
  }
}

/** The real generator: the same openapi-typescript the SDK shells out to, via its Node API (no npx, works offline). */
export async function generateMerchantTypes(spec: Record<string, unknown>): Promise<string> {
  return astToString(await openapiTS(spec as unknown as OpenAPI3));
}

/** GitHub Actions annotation when running in CI, plain text locally (mirrors `check-merchant-snapshot.mjs`). */
export function warnLine(message: string): string {
  return process.env.GITHUB_ACTIONS === 'true' ? `::warning::${message}` : `Warning: ${message}`;
}

export interface CodegenRecord {
  source: string;
  specSha256: string;
  specVersion: string | null;
  /** The backend's own hash once B1 ships (`x-queek-spec-sha` info field); absent until then. */
  serverSpecSha256?: string;
  generatedAt: string;
  paths: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Crash-safe write: the temp file lives in the same directory, so the
 * rename is one atomic step — a crash can never leave a half-written
 * `types/merchant.ts` beside a stale record (or vice versa).
 */
export function atomicWriteFile(path: string, content: string): void {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

const SPEC_SHA_RE = /^ \* Spec sha256: ([0-9a-f]{64})$/m;

/**
 * The recorded pin: `.queek/codegen.json` first (the local debug aid),
 * falling back to the committed `types/merchant.ts` provenance header —
 * the header is what survives a fresh clone (`.queek/` is gitignored in
 * apps) and what reviewers see in diffs. Null when neither exists.
 */
export function recordedSpecHash(appDir: string): string | null {
  const dir = resolve(appDir);
  try {
    const record = JSON.parse(readFileSync(join(queekDir(dir), CODEGEN_RECORD_FILE), 'utf8')) as { specSha256?: unknown };
    if (typeof record.specSha256 === 'string' && /^[0-9a-f]{64}$/.test(record.specSha256)) return record.specSha256;
  } catch {
    // Absent or corrupt — fall through to the committed header below.
  }
  let types: string;
  try {
    types = readFileSync(join(dir, CODEGEN_TYPES_FILE), 'utf8');
  } catch {
    return null;
  }
  return SPEC_SHA_RE.exec(types)?.[1] ?? null;
}

/** The exact stderr line for an offline run (kept here so tests pin the command's mapping). */
export function offlineStderr(result: CodegenSkipped): string {
  return warnLine(result.reason);
}

/** A refusal's exit: `CodegenError`/`TomlError` carry their own, anything else is 1. */
export function errorExitCode(error: unknown): number {
  const code = (error as { exitCode?: unknown } | null)?.exitCode;
  return typeof code === 'number' ? code : 1;
}

export function provenanceHeader(source: string, hash: string): string {
  return (
    `/**\n` +
    ` * GENERATED by \`queek app codegen\` from ${source} — do not edit by hand.\n` +
    ` * Spec sha256: ${hash}\n` +
    ` * Refresh with: queek app codegen [spec]\n` +
    ` */\n`
  );
}

export interface RunCodegenOptions {
  appDir: string;
  variant?: string;
  /** A spec URL or local file. Absent: the live Merchant spec. */
  source?: string;
  fetchFn?: SpecFetch;
  generateFn?: SpecGenerate;
  now?: () => Date;
}

/**
 * Fetch → sanity-check → generate → write `types/merchant.ts` +
 * `.queek/codegen.json`. Network failure always warns and exits 0 with the
 * existing types kept (MUST-4, mirroring `check-merchant-snapshot.mjs`).
 * Any other failure on the default live URL does the same (a transient
 * edge/backend problem must never red CI); on an explicit source it throws,
 * so a named file/URL is refused loudly, never silently kept. When the
 * recorded hash already matches and the types file exists, nothing is
 * rewritten (`unchanged`, so reruns leave the tree clean) — delete
 * `types/merchant.ts` to force a regeneration (e.g. after a generator
 * upgrade with an unchanged spec).
 */
export async function runCodegen(options: RunCodegenOptions): Promise<CodegenResult> {
  const { appDir, variant, source, fetchFn, generateFn, now } = options;
  resolveTomlPath(resolve(appDir), variant);
  const dir = resolve(appDir);
  const from = source ?? MERCHANT_SPEC_URL;
  const explicit = source !== undefined;
  const generate = generateFn ?? generateMerchantTypes;

  const skip = (reason: string): CodegenSkipped => ({ offline: true, reason });

  let specText: string;
  if (/^https?:\/\//.test(from)) {
    const get: SpecFetch = fetchFn ?? ((url, init) => fetch(url, init) as Promise<SpecResponse>);
    let response: SpecResponse;
    try {
      response = await get(from, { signal: AbortSignal.timeout(SPEC_FETCH_TIMEOUT_MS) });
    } catch (error) {
      return skip(`could not fetch the Merchant API spec from ${from} (${error instanceof Error ? error.message : error}); keeping existing types.`);
    }
    if (!response.ok) {
      if (!explicit) return skip(`the live Merchant API spec answered HTTP ${response.status}; keeping existing types.`);
      throw new CodegenError(`Could not fetch Merchant API spec: ${response.status} ${from}`);
    }
    if (isHtmlContentType(response.headers.get('content-type'))) {
      if (!explicit) return skip(`the live Merchant API spec answered HTML (edge error page); keeping existing types.`);
      throw new CodegenError(
        `Refused HTML from ${from} — expected the Merchant OpenAPI spec, got an error page (login wall or edge 5xx).`,
      );
    }
    specText = await response.text();
  } else {
    try {
      specText = readFileSync(resolve(dir, from), 'utf8');
    } catch (error) {
      throw new CodegenError(`Cannot read ${from}: ${(error as Error).message}`, 2);
    }
  }

  let spec: unknown;
  try {
    spec = parseSpecText(specText, from);
  } catch (error) {
    if (!explicit && error instanceof CodegenError) return skip(`${error.message} Keeping existing types.`);
    throw error;
  }
  try {
    sanityCheckSpec(spec);
  } catch (error) {
    if (!explicit && error instanceof CodegenError) return skip(`${error.message} Keeping existing types.`);
    throw error;
  }

  const normalized = normalizeSpec(spec);
  const hash = specSha256(specText);
  const pathCount = Object.keys(spec.paths).length;
  const file = CODEGEN_TYPES_FILE;
  const recordFile = join('.queek', CODEGEN_RECORD_FILE);
  if (recordedSpecHash(dir) === hash && existsSync(join(dir, file))) {
    return { offline: false, unchanged: true, file, recordFile, source: from, specSha256: hash, paths: pathCount };
  }
  const info = isRecord(spec.info) ? spec.info : null;
  const specVersion = typeof info?.version === 'string' ? info.version : null;
  const serverHash = typeof info?.['x-queek-spec-sha'] === 'string' ? (info['x-queek-spec-sha'] as string) : undefined;

  const body = await generate(normalized).catch((error: Error) => {
    throw new CodegenError(`openapi-typescript failed: ${error.message}`);
  });
  mkdirSync(join(dir, 'types'), { recursive: true });
  atomicWriteFile(join(dir, file), `${provenanceHeader(from, hash)}${body}`);
  mkdirSync(queekDir(dir), { recursive: true });
  const record: CodegenRecord = {
    source: from,
    specSha256: hash,
    specVersion,
    ...(serverHash !== undefined ? { serverSpecSha256: serverHash } : {}),
    generatedAt: (now ?? (() => new Date()))().toISOString(),
    paths: pathCount,
  };
  atomicWriteFile(join(queekDir(dir), CODEGEN_RECORD_FILE), `${JSON.stringify(record, null, 2)}\n`);
  return { offline: false, unchanged: false, file, recordFile, source: from, specSha256: hash, paths: pathCount };
}
