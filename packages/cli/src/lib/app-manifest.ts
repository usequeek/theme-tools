import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

/**
 * `queek.app.toml` — the local source of truth for an app's manifest, mapped
 * EXACTLY to the backend's `AppManifestValidator::topLevelKeys()` (28 keys).
 * The server never fetches a live manifest URL; `deploy` pushes this file.
 *
 * Secrets NEVER live here: the registration secret (`whsec_…`) goes to
 * `.queek/.env.local` (gitignored), `type=secret` settings declare a slot
 * only. Anything secret-shaped in the toml is refused before it can ship.
 */

export const APP_TOML = 'queek.app.toml';
export const APP_TOML_VARIANT = (name: string): string => `queek.app.${name}.toml`;

/** The 28 manifest keys the backend accepts — nothing else is sent. */
export const MANIFEST_KEYS = [
  'slug', 'name', 'description', 'icon', 'developer', 'version', 'distribution',
  'category', 'tagline', 'description_long', 'highlights', 'logo_url', 'pricing',
  'developer_url', 'privacy_url', 'support_url', 'demo_url', 'video_url', 'scopes', 'optional_scopes', 'webhook_topics',
  'settings', 'install_url', 'uninstall_url', 'settings_url', 'webhook_url',
  'extensions', 'dashboard',
] as const;

/**
 * The `extensions` sub-keys the backend accepts (`validateExtensions` +
 * `validateNav`): nothing else is sent under `extensions`.
 */
export const EXTENSION_KEYS = ['proxy', 'blocks', 'merchant_page_url', 'nav'] as const;

export type ManifestKey = (typeof MANIFEST_KEYS)[number];
export type AppManifest = Partial<Record<ManifestKey, unknown>> & { slug: string; name: string; scopes: string[]; optional_scopes?: string[]; install_url: string; uninstall_url: string };

export class TomlError extends Error {
  readonly exitCode = 2;
}

/** `Unknown field 'x' in manifest.` — byte-identical to the backend's `rejectUnknown`. */
export const unknownField = (key: string, where = 'manifest'): string => `Unknown field '${key}' in ${where}.`;

const TOP_LEVEL_TOML_KEYS = new Set([
  'slug', 'handle', 'name', 'version', 'distribution', 'icon', 'developer', 'category',
  'listing', 'access', 'webhooks', 'app', 'settings', 'extensions', 'dashboard', 'dev',
]);

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ICON_RE = /^[a-z0-9_-]+$/;
const SETTING_KEY_RE = /^[a-z0-9_]{1,64}$/;

/** Scopes the CLI refuses without asking the server (plan: never `merchant-apps-*`). */
const NON_DELEGABLE_PREFIXES = ['merchant-apps-', 'merchant-api_keys-', 'merchant-roles-', 'merchant-users-', 'merchant-employees-', 'merchant-pos-'];

const DASHBOARD_BLOCK_TARGETS = ['order-details', 'product-details'];
const DASHBOARD_ACTION_TARGETS = ['order-details'];
const DASHBOARD_PRINT_TARGETS = ['order-print'];
const DASHBOARD_PRIMITIVES = ['date', 'time', 'select', 'text', 'slot-list'];
const DASHBOARD_WHEN_FIELDS = ['order.has_appointment', 'order.is_paid', 'product.has_files'];
/** Closed visibility conditions for an extension block (validator BLOCK_AVAILABLE_IF). */
const BLOCK_AVAILABLE_IF = ['declared_products'];
const EXTENSION_BLOCK_TARGETS = ['product'];
const EXTENSION_PRIMITIVES = ['date', 'time', 'select'];
const EXTENSION_BLOCK_TYPES = ['app_block', 'app_embed'];

/** Key/value shapes that smell like a secret and are refused in the toml. */
function secretProblem(path: string, key: string, value: unknown): string | null {
  const lower = key.toLowerCase();
  if (lower.includes('secret') || lower.includes('private_key') || lower === 'kid' || lower === 'database_url' || lower === 'app_encryption_key') {
    return `${path}: '${key}' looks like a secret — secrets never live in ${APP_TOML}; deploy writes them to .queek/.env.local instead.`;
  }
  if (typeof value === 'string' && (value.startsWith('whsec_') || /sk-(live|test)-/.test(value))) {
    return `${path}: '${key}' holds a secret value — secrets never live in ${APP_TOML}.`;
  }
  return null;
}

function scanSecrets(node: unknown, path: string, problems: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => scanSecrets(item, `${path}[${index}]`, problems));
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const hit = secretProblem(path || 'manifest', key, value);
      if (hit) problems.push(hit);
      scanSecrets(value, path ? `${path}.${key}` : key, problems);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function httpsProblem(field: string, value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('https://')) {
    return `The ${field} must be an https URL.`;
  }
  return null;
}

/**
 * One grantable scope entry, mirroring the backend's `ManifestScopeRule`
 * (a Laratrust `merchant-*` permission a key may actually hold; the
 * `merchant-apps-*` family and friends can never be granted). Shared by
 * `scopes` and `optional_scopes` — the backend applies the same rule to
 * both tiers.
 */
function checkScope(scope: unknown, fail: (message: string) => never): void {
  if (typeof scope !== 'string' || scope === '') throw fail('Each scope must be a Laratrust permission name.');
  if (NON_DELEGABLE_PREFIXES.some((prefix) => scope.startsWith(prefix))) {
    throw fail(`The '${scope}' scope can never be granted to an app: an installation key must never install apps, manage keys or read the team directory.`);
  }
}

function checkSchemaFields(list: unknown, where: string, primitives: string[], problems: string[]): void {
  if (!Array.isArray(list)) {
    problems.push(`The ${where} schema must be a list.`);
    return;
  }
  if (list.length > 12) problems.push(`The ${where} schema must not have more than 12 fields.`);
  list.forEach((field, index) => {
    if (!isRecord(field)) {
      problems.push(`Unknown field '${index}' in ${where}.schema.`);
      return;
    }
    for (const key of Object.keys(field)) {
      if (!['key', 'label', 'type', 'required', 'options'].includes(key)) problems.push(unknownField(key, `${where}.schema[${index}]`));
    }
    if (typeof field.key !== 'string' || !SETTING_KEY_RE.test(field.key)) problems.push(`The ${where}.schema[${index}].key must match [a-z0-9_]{1,64}.`);
    if (typeof field.label !== 'string' || field.label.length > 120) problems.push(`The ${where}.schema[${index}].label is required (max 120).`);
    if (!primitives.includes(field.type as string)) problems.push(`The schema primitive must be one of: ${primitives.join(', ')}.`);
    if (field.type === 'select') {
      if (!Array.isArray(field.options) || field.options.length < 1) {
        problems.push('A select primitive needs at least one option.');
      } else {
        if (field.options.length > 50) problems.push(`The ${where}.schema[${index}].options must not have more than 50 options.`);
        field.options.forEach((option: unknown, optionIndex: number) => {
          if (typeof option !== 'string' || option.length > 120) {
            problems.push(`The ${where}.schema[${index}].options[${optionIndex}] must be a string (max 120).`);
          }
        });
      }
    }
  });
}

/**
 * Resolve which toml file to read: `-c/--config <name>` picks
 * `queek.app.<name>.toml` (Shopify parity), otherwise `queek.app.toml`,
 * looked up in `dir`.
 */
export function resolveTomlPath(dir: string, variant?: string): string {
  const file = variant ? APP_TOML_VARIANT(variant) : APP_TOML;
  const full = resolve(dir, file);
  if (!existsSync(full)) {
    throw new TomlError(variant ? `No ${file} in ${dir} (from --config ${variant}).` : `No ${APP_TOML} in ${dir} — run \`queek app init\` first or pass --path.`);
  }
  return full;
}

export interface LoadedToml {
  path: string;
  doc: Record<string, unknown>;
}

/** Parse (but do not validate) a toml file. */
export function loadTomlFile(path: string): LoadedToml {
  let doc: unknown;
  try {
    doc = parseToml(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new TomlError(`Cannot parse ${path}: ${(error as Error).message}`);
  }
  if (!isRecord(doc)) throw new TomlError(`Cannot parse ${path}: the top level must be a table.`);
  return { path, doc };
}

/**
 * Map the grouped toml onto the flat 28-key manifest the API takes.
 * Throws `TomlError` (exit 2) on anything the backend would refuse —
 * the same names, the same limits, the same error text where it matters.
 */
export interface TomlManifest {
  manifest: AppManifest;
  /** Non-fatal notices (e.g. an ignored `version`) for the command to print once. */
  warnings: string[];
  /** The CLI-only `[dev]` table (how `queek app dev` starts the app) — never sent to the backend, like `handle`. */
  dev?: DevTable;
}

/**
 * `[dev]` in queek.app.toml (Shopify `shopify.web.toml` parity: the command
 * that serves the app + the port it listens on). CLI-only: `toManifest`
 * validates it but never maps it onto the manifest.
 */
export interface DevTable {
  command: string;
  port: number;
}

/** Default local app port when neither `[dev].port` nor `--port` names one. */
export const DEFAULT_DEV_PORT = 3000;

/**
 * Map the grouped toml onto the flat manifest the API takes. `version` is
 * deliberately NOT mapped: queek.app.toml carries no version (Shopify
 * parity) — the backend auto-assigns the next patch, or `--version` names
 * one. A leftover `version` warns once instead of failing old checkouts.
 */
export function toManifest(doc: Record<string, unknown>): TomlManifest {
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const key of Object.keys(doc)) {
    if (!TOP_LEVEL_TOML_KEYS.has(key)) problems.push(unknownField(key));
  }
  scanSecrets(doc, '', problems);
  if (problems.length > 0) throw new TomlError(problems.join('\n'));

  // `handle` is CLI-only sugar, translated to `slug` before POST (the
  // backend rejects unknown keys including `handle`).
  const handle = doc.handle as unknown;
  const slug = doc.slug as unknown;
  if (handle !== undefined && slug !== undefined) {
    throw new TomlError("Use either 'slug' or 'handle', not both — they mean the same thing.");
  }
  const resolvedSlug = (handle ?? slug) as unknown;
  if (typeof resolvedSlug !== 'string' || !SLUG_RE.test(resolvedSlug)) {
    throw new TomlError('The slug must be 2-64 lowercase letters, digits or dashes.');
  }

  const fail = (message: string): never => {
    throw new TomlError(message);
  };

  // `[dev]` is CLI-only (Shopify `shopify.web.toml` parity): validated here,
  // never mapped onto the manifest below.
  let dev: DevTable | undefined;
  if (doc.dev !== undefined) {
    if (!isRecord(doc.dev)) throw fail('The dev section must be a table.');
    for (const key of Object.keys(doc.dev)) {
      if (!['command', 'port'].includes(key)) problems.push(unknownField(key, 'manifest.dev'));
    }
    if (problems.length > 0) throw new TomlError(problems.join('\n'));
    const table = doc.dev;
    if (typeof table.command !== 'string' || table.command.trim() === '') {
      throw fail('The dev.command field is required (how `queek app dev` starts the app, e.g. "tsx watch src/index.ts").');
    }
    let port = DEFAULT_DEV_PORT;
    if (table.port !== undefined) {
      if (typeof table.port !== 'number' || !Number.isInteger(table.port) || table.port < 1 || table.port > 65535) {
        throw fail('The dev.port must be a port number (1-65535).');
      }
      port = table.port;
    }
    dev = { command: table.command, port };
  }

  const str = (value: unknown, field: string, max: number, required: boolean): string | undefined => {
    if (value === undefined) {
      if (required) throw fail(`The ${field} field is required.`);
      return undefined;
    }
    if (typeof value !== 'string' || value.length > max) throw fail(`The ${field} field is required (max ${max}).`);
    return value as string;
  };

  const name = str(doc.name, 'name', 120, true) as string;
  if (doc.version !== undefined) {
    warnings.push('`version` in queek.app.toml is ignored — the backend auto-assigns the next patch; name one with `queek app deploy --version X.Y.Z` instead.');
  }
  const distribution = doc.distribution === undefined ? 'public' : (doc.distribution as string);
  if (!['public', 'development'].includes(distribution as string)) throw fail('The distribution must be one of: public, development.');
  if (doc.icon !== undefined && (typeof doc.icon !== 'string' || doc.icon.length > 64 || !ICON_RE.test(doc.icon))) {
    throw fail('The icon must be an icon name (letters, digits, dash, underscore) — never a URL or image.');
  }

  const listing = (doc.listing ?? {}) as Record<string, unknown>;
  const access = (doc.access ?? {}) as Record<string, unknown>;
  const webhooks = (doc.webhooks ?? {}) as Record<string, unknown>;
  const app = (doc.app ?? {}) as Record<string, unknown>;
  for (const [group, allowed, where] of [
    [listing, ['description', 'tagline', 'description_long', 'highlights', 'logo_url', 'pricing', 'developer_url', 'privacy_url', 'support_url', 'demo_url', 'video_url'], 'manifest.listing'],
    [access, ['scopes', 'optional_scopes'], 'manifest.access'],
    [webhooks, ['topics', 'url'], 'manifest.webhooks'],
    [app, ['install_url', 'uninstall_url', 'settings_url'], 'manifest.app'],
  ] as const) {
    if (!isRecord(group)) throw fail(`The ${where} section must be a table.`);
    for (const key of Object.keys(group)) {
      if (!(allowed as readonly string[]).includes(key)) problems.push(unknownField(key, where));
    }
  }
  if (problems.length > 0) throw new TomlError(problems.join('\n'));

  // `scopes` is present-but-empty-able (backend `present,array`: Shopify
  // parity, `scopes = ""` with the field still present) — `required` would
  // refuse `[]`. Each entry follows the backend's ManifestScopeRule, same as
  // `optional_scopes` below.
  const scopes = access.scopes as unknown;
  if (!Array.isArray(scopes)) throw fail('The scopes field is required (a list, possibly empty).');
  for (const scope of scopes as unknown[]) checkScope(scope, fail);
  // Optional scopes (backend `sometimes,array`): requested post-install,
  // never granted at install. Same grantable-scope rule; disjointness from
  // `scopes` is checked below (backend: one tier only).
  const optionalScopes = access.optional_scopes as unknown;
  if (optionalScopes !== undefined) {
    if (!Array.isArray(optionalScopes)) throw fail('The optional_scopes field must be a list.');
    for (const scope of optionalScopes as unknown[]) checkScope(scope, fail);
    const overlap = (optionalScopes as unknown[]).filter((scope) => (scopes as unknown[]).includes(scope));
    if (overlap.length > 0) {
      throw fail(`Optional scopes must not repeat required scopes: ${(overlap as string[]).join(', ')}.`);
    }
  }

  const topics = (webhooks.topics ?? []) as unknown;
  if (!Array.isArray(topics)) throw fail('The webhooks.topics field must be a list.');
  const webhookUrl = webhooks.url as unknown;
  if ((topics as unknown[]).length > 0 && webhookUrl === undefined) throw fail('webhook_topics needs webhook_url: topics without a receiver URL are refused.');
  for (const urlField of [['install_url', app.install_url], ['uninstall_url', app.uninstall_url], ['settings_url', app.settings_url], ['webhook_url', webhookUrl]] as const) {
    if (urlField[1] === undefined) {
      if (urlField[0] === 'install_url' || urlField[0] === 'uninstall_url') throw fail(`The ${urlField[0]} field is required.`);
      continue;
    }
    const problem = httpsProblem(urlField[0], urlField[1]);
    if (problem) throw fail(problem);
  }

  const settings = (doc.settings ?? []) as unknown;
  if (!Array.isArray(settings)) throw fail('The settings section must be a list of [[settings]] tables.');
  (settings as unknown[]).forEach((field, index) => {
    if (!isRecord(field)) throw fail(unknownField(String(index), 'manifest.settings'));
    for (const key of Object.keys(field)) {
      if (!['key', 'label', 'type', 'required', 'options', 'help'].includes(key)) problems.push(unknownField(key, `manifest.settings[${index}]`));
    }
    if (typeof field.key !== 'string' || !SETTING_KEY_RE.test(field.key)) throw fail(`The settings[${index}].key must match [a-z0-9_]{1,64}.`);
    if (typeof field.label !== 'string' || field.label.length > 120) throw fail(`The settings[${index}].label is required (max 120).`);
    if (!['string', 'secret', 'number', 'boolean', 'select'].includes(field.type as string)) {
      throw fail(`The settings[${index}].type must be one of: string, secret, number, boolean, select.`);
    }
    if (field.type === 'select') {
      if (!Array.isArray(field.options) || (field.options as unknown[]).length < 1) {
        throw fail('A select setting needs at least one option.');
      }
      for (const [optionIndex, option] of (field.options as unknown[]).entries()) {
        if (typeof option !== 'string' || (option as string).length > 120) {
          throw fail(`The settings[${index}].options[${optionIndex}] must be a string (max 120).`);
        }
      }
    }
    if (field.help !== undefined && field.help !== null && (typeof field.help !== 'string' || (field.help as string).length > 500)) {
      throw fail(`The settings[${index}].help field must be a string (max 500).`);
    }
  });

  const manifest: AppManifest = { slug: resolvedSlug, name, scopes: scopes as string[], install_url: app.install_url as string, uninstall_url: app.uninstall_url as string };
  // Absent-when-undeclared parity (backend `sometimes`): an app without
  // `optional_scopes` re-registers byte-identical to its pre-optional
  // versions, or the registry mints a phantom version.
  if (optionalScopes !== undefined) manifest.optional_scopes = optionalScopes as string[];
  if (distribution !== 'public') manifest.distribution = distribution;
  for (const key of ['icon', 'developer', 'category'] as const) {
    if (doc[key] !== undefined) manifest[key] = doc[key];
  }
  const listingOut: Record<string, unknown> = {};
  for (const key of ['description', 'tagline', 'description_long', 'highlights', 'logo_url', 'pricing', 'developer_url', 'privacy_url', 'support_url', 'demo_url', 'video_url']) {
    if (listing[key] !== undefined) listingOut[key] = listing[key];
  }
  if ((listingOut.description_long as string)?.length > 2000) throw fail('The description_long field must be plain text (max 2000).');
  // Listing promo URLs ride the same guard as the handoff URLs server-side
  // (assertAppUrl: https + WebhookUrlGuard, capped 2048); the video host is
  // a NAMED allowlist (YouTube/Vimeo — the store page embeds it). Mirrored
  // here so a mistake fails on the developer's machine, same error text.
  if (listingOut.demo_url !== undefined) checkCappedUrl(listingOut.demo_url, 'demo_url', fail);
  if (listingOut.video_url !== undefined) {
    checkCappedUrl(listingOut.video_url, 'video_url', fail);
    if (!isAllowedVideoHost(listingOut.video_url as string)) throw fail('The video_url must be a YouTube or Vimeo URL.');
  }
  Object.assign(manifest, listingOut);
  manifest.webhook_topics = topics as string[];
  if (webhookUrl !== undefined) manifest.webhook_url = webhookUrl as string;
  if (app.settings_url !== undefined) manifest.settings_url = app.settings_url as string;
  if ((settings as unknown[]).length > 0) manifest.settings = settings as AppManifest['settings'];

  checkExtensions(doc.extensions, manifest, fail);
  // Declared means either tier (backend): an optional-scope action
  // registers, and the grant-based submit check passes it once approved.
  checkDashboard(doc.dashboard, manifest, fail, [...manifest.scopes, ...(manifest.optional_scopes ?? [])]);

  if (problems.length > 0) throw new TomlError(problems.join('\n'));

  // Closed-world guard: the mapped object carries only the 28 keys, so a
  // typo can never smuggle an unknown field past this point.
  for (const key of Object.keys(manifest)) {
    if (!(MANIFEST_KEYS as readonly string[]).includes(key)) throw new TomlError(unknownField(key));
  }
  return { manifest, warnings, ...(dev !== undefined ? { dev } : {}) };
}

/** Strict X.Y.Z for `deploy --version` (the backend auto-assigns when absent). */
export function assertSemver(version: string): void {
  if (!SEMVER_RE.test(version)) throw new TomlError('The --version must be strict X.Y.Z (e.g. 1.2.0).');
}

/**
 * The promo-video host allowlist, mirroring the backend's isAllowedVideoHost
 * (YouTube/Vimeo — the store page embeds it): exact host or any subdomain,
 * case-insensitive. Anything else is refused at deploy, so refuse it here.
 */
function isAllowedVideoHost(value: string): boolean {
  let host = '';
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return false;
  }
  return ['youtube.com', 'youtu.be', 'vimeo.com'].some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/** Offline https check mirroring assertAppUrl's scheme line (the guard's DNS half stays server-side). */
function checkUrl(value: unknown, field: string, fail: (message: string) => never): void {
  const problem = httpsProblem(field, value);
  if (problem) throw fail(problem);
}

function checkImage(image: unknown, where: string, problems: string[], fail: (message: string) => never): void {
  // A non-table image is nulled server-side (normalizeExtensions/normalizeDashboard);
  // the container key's own allow-list lives with the caller.
  if (!isRecord(image)) return;
  for (const key of Object.keys(image)) {
    if (!['media_id', 'url'].includes(key)) problems.push(unknownField(key, `${where}.image`));
  }
  if (image.url !== undefined && image.url !== null) checkCappedUrl(image.url, `${where}.image.url`, fail);
}

/**
 * https URL the backend caps at 2048 (proxy.url, merchant_page_url,
 * block link_url/image.url, dashboard link_url/notify_url — validator
 * `max:2048`). Fields the backend leaves uncapped (install_url and friends)
 * keep the plain scheme check: refusing locally what the server accepts
 * would be a lie.
 */
function checkCappedUrl(value: unknown, field: string, fail: (message: string) => never): void {
  checkUrl(value, field, fail);
  if (typeof value === 'string' && value.length > 2048) throw fail(`The ${field} must not be longer than 2048 characters.`);
}

function checkExtensions(extensions: unknown, manifest: AppManifest, fail: (message: string) => never): void {
  if (extensions === undefined) return;
  if (!isRecord(extensions)) throw fail('The extensions section must be a table.');
  const problems: string[] = [];
  for (const key of Object.keys(extensions)) {
    if (!(EXTENSION_KEYS as readonly string[]).includes(key)) problems.push(unknownField(key, 'manifest.extensions'));
  }
  if (problems.length > 0) throw new TomlError(problems.join('\n'));
  const out: Record<string, unknown> = {};
  if (extensions.proxy !== undefined) {
    if (!isRecord(extensions.proxy)) throw fail('The extensions.proxy section must be a table.');
    for (const key of Object.keys(extensions.proxy)) {
      if (!['url', 'subpath', 'share_customer_id'].includes(key)) problems.push(unknownField(key, 'manifest.extensions.proxy'));
    }
    if (problems.length > 0) throw new TomlError(problems.join('\n'));
    const proxy = extensions.proxy;
    if (typeof proxy.url !== 'string') throw fail('The extensions.proxy.url field is required.');
    checkCappedUrl(proxy.url, 'extensions.proxy.url', fail);
    if (typeof proxy.subpath !== 'string' || !/^[a-z0-9][a-z0-9-]{1,39}$/.test(proxy.subpath)) {
      throw fail('The proxy subpath must be 2-40 lowercase letters, digits or dashes.');
    }
    out.proxy = { url: proxy.url, subpath: proxy.subpath, ...(proxy.share_customer_id !== undefined ? { share_customer_id: proxy.share_customer_id } : {}) };
  }
  if (extensions.merchant_page_url !== undefined) {
    checkCappedUrl(extensions.merchant_page_url, 'extensions.merchant_page_url', fail);
    out.merchant_page_url = extensions.merchant_page_url;
  }
  if (extensions.nav !== undefined) {
    out.nav = checkNav(extensions.nav, extensions.merchant_page_url, fail);
  }
  const blocks = (extensions.blocks ?? []) as unknown;
  if (!Array.isArray(blocks)) throw fail('The extensions.blocks section must be a list of [[extensions.blocks]] tables.');
  if ((blocks as unknown[]).length > 10) throw fail('The extensions.blocks list must not have more than 10 blocks.');
  const checked: unknown[] = [];
  (blocks as Record<string, unknown>[]).forEach((block, index) => {
    const where = `manifest.extensions.blocks[${index}]`;
    if (!isRecord(block)) throw fail(unknownField(String(index), 'manifest.extensions.blocks'));
    for (const key of Object.keys(block)) {
      if (!['key', 'type', 'title', 'description', 'targets', 'available_if', 'schema', 'link_url', 'image'].includes(key)) problems.push(unknownField(key, where));
    }
    if (typeof block.key !== 'string' || !SETTING_KEY_RE.test(block.key)) throw fail(`The ${where}.key must match [a-z0-9_]{1,64}.`);
    if (typeof block.title !== 'string' || block.title.length > 80) throw fail(`The ${where}.title field is required (max 80).`);
    if (block.description !== undefined && block.description !== null && (typeof block.description !== 'string' || block.description.length > 500)) {
      throw fail(`The ${where}.description field must be a string (max 500).`);
    }
    if (block.type !== undefined && !EXTENSION_BLOCK_TYPES.includes(block.type as string)) {
      throw fail(`The block type must be one of: ${EXTENSION_BLOCK_TYPES.join(', ')}.`);
    }
    if (!Array.isArray(block.targets) || (block.targets as unknown[]).length < 1) throw fail(`The ${where}.targets field is required (at least one).`);
    for (const target of block.targets as unknown[]) {
      if (!EXTENSION_BLOCK_TARGETS.includes(target as string)) throw fail(`The block target must be one of: ${EXTENSION_BLOCK_TARGETS.join(', ')}.`);
    }
    if (block.available_if !== undefined && !BLOCK_AVAILABLE_IF.includes(block.available_if as string)) {
      throw fail(`The block visibility condition must be one of: ${BLOCK_AVAILABLE_IF.join(', ')}.`);
    }
    if (block.schema !== undefined) checkSchemaFields(block.schema, where, EXTENSION_PRIMITIVES, problems);
    if (block.link_url !== undefined && block.link_url !== null) checkCappedUrl(block.link_url, `${where}.link_url`, fail);
    checkImage(block.image, where, problems, fail);
    checked.push(block);
  });
  if (problems.length > 0) throw new TomlError(problems.join('\n'));
  if (Object.keys(out).length > 0 || (blocks as unknown[]).length > 0) {
    manifest.extensions = { ...out, ...(((blocks as unknown[]).length > 0) ? { blocks: checked } : {}) };
  }
}

function checkDashboard(dashboard: unknown, manifest: AppManifest, fail: (message: string) => never, scopes: string[]): void {
  if (dashboard === undefined) return;
  if (!isRecord(dashboard)) throw fail('The dashboard section must be a table.');
  const problems: string[] = [];
  for (const key of Object.keys(dashboard)) {
    if (!['blocks', 'actions', 'print'].includes(key)) problems.push(unknownField(key, 'manifest.dashboard'));
  }
  if (problems.length > 0) throw new TomlError(problems.join('\n'));
  const out: Record<string, unknown> = {};
  const checkList = (key: 'blocks' | 'actions' | 'print', max: number): Record<string, unknown>[] => {
    const list = (dashboard[key] ?? []) as unknown;
    if (!Array.isArray(list)) throw fail(`The dashboard.${key} section must be a list.`);
    if ((list as unknown[]).length > max) throw fail(`The dashboard.${key} list must not have more than ${max} entries.`);
    return list as Record<string, unknown>[];
  };
  for (const [index, block] of checkList('blocks', 10).entries()) {
    const where = 'manifest.dashboard.blocks';
    const row = `${where}[${index}]`;
    for (const key of Object.keys(block)) {
      if (!['key', 'title', 'target', 'schema', 'when', 'link_url', 'image'].includes(key)) problems.push(unknownField(key, where));
    }
    if (typeof block.key !== 'string' || !SETTING_KEY_RE.test(block.key)) throw fail(`The ${row}.key must match [a-z0-9_]{1,64}.`);
    if (typeof block.title !== 'string' || block.title.length > 80) throw fail(`The ${row}.title field is required (max 80).`);
    if (!DASHBOARD_BLOCK_TARGETS.includes(block.target as string)) {
      throw fail(`The dashboard block target must be one of: ${DASHBOARD_BLOCK_TARGETS.join(', ')}.`);
    }
    if (block.schema !== undefined) checkSchemaFields(block.schema, where, DASHBOARD_PRIMITIVES, problems);
    if (block.when !== undefined) {
      for (const when of block.when as unknown[]) {
        if (!DASHBOARD_WHEN_FIELDS.includes(when as string)) throw fail(`The dashboard \`when\` field must be one of: ${DASHBOARD_WHEN_FIELDS.join(', ')}.`);
      }
    }
    if (block.link_url !== undefined && block.link_url !== null) checkCappedUrl(block.link_url, `${where}.link_url`, fail);
    checkImage(block.image, where, problems, fail);
  }
  for (const [index, action] of checkList('actions', 10).entries()) {
    const where = 'manifest.dashboard.actions';
    const row = `${where}[${index}]`;
    for (const key of Object.keys(action)) {
      if (!['key', 'title', 'target', 'scope', 'effect', 'schema', 'when', 'notify_url'].includes(key)) problems.push(unknownField(key, where));
    }
    if (typeof action.key !== 'string' || !SETTING_KEY_RE.test(action.key)) throw fail(`The ${row}.key must match [a-z0-9_]{1,64}.`);
    if (typeof action.title !== 'string' || action.title.length > 80) throw fail(`The ${row}.title field is required (max 80).`);
    if (!DASHBOARD_ACTION_TARGETS.includes(action.target as string)) {
      throw fail(`The dashboard action target must be one of: ${DASHBOARD_ACTION_TARGETS.join(', ')}.`);
    }
    if (typeof action.scope !== 'string' || action.scope === '') throw fail(`The ${where} scope field is required.`);
    if (action.effect !== 'order_appointment') throw fail('The dashboard action effect must be one of: order_appointment.');
    if (typeof action.notify_url !== 'string') throw fail(`The ${where} notify_url field is required.`);
    checkCappedUrl(action.notify_url, `${where}.notify_url`, fail);
    checkImage(action.image, where, problems, fail);
    if (!scopes.includes(action.scope)) {
      throw fail(`Dashboard action '${action.key}' declares scope '${action.scope}' the manifest never grants.`);
    }
    if (action.schema !== undefined) checkSchemaFields(action.schema, where, DASHBOARD_PRIMITIVES, problems);
    if (action.when !== undefined) {
      for (const when of action.when as unknown[]) {
        if (!DASHBOARD_WHEN_FIELDS.includes(when as string)) throw fail(`The dashboard \`when\` field must be one of: ${DASHBOARD_WHEN_FIELDS.join(', ')}.`);
      }
    }
  }
  checkList('print', 5).forEach((row, index) => {
    const where = `manifest.dashboard.print[${index}]`;
    if (!isRecord(row)) {
      problems.push(unknownField(String(index), 'manifest.dashboard.print'));
      return;
    }
    for (const key of Object.keys(row)) {
      if (!['key', 'title', 'target', 'fields'].includes(key)) problems.push(unknownField(key, where));
    }
    if (typeof row.key !== 'string' || !SETTING_KEY_RE.test(row.key)) throw fail(`The ${where}.key must match [a-z0-9_]{1,64}.`);
    if (typeof row.title !== 'string' || row.title.length > 80) throw fail(`The ${where}.title field is required (max 80).`);
    if (!DASHBOARD_PRINT_TARGETS.includes(row.target as string)) {
      throw fail(`The dashboard print target must be one of: ${DASHBOARD_PRINT_TARGETS.join(', ')}.`);
    }
    if (row.fields !== undefined && !Array.isArray(row.fields)) {
      problems.push(`The ${where}.fields must be a list.`);
    } else if (Array.isArray(row.fields) && row.fields.length > 20) {
      throw fail(`The ${where}.fields must not have more than 20 fields.`);
    }
    for (const [fieldIndex, field] of ((row.fields ?? []) as unknown[]).entries()) {
      if (!isRecord(field)) {
        problems.push(unknownField(String(fieldIndex), `${where}.fields`));
        continue;
      }
      for (const key of Object.keys(field)) {
        if (!['key', 'label'].includes(key)) problems.push(unknownField(key, `${where}.fields[${fieldIndex}]`));
      }
    }
  });
  if (problems.length > 0) throw new TomlError(problems.join('\n'));
  const blocks = dashboard.blocks as unknown[] | undefined;
  const actions = dashboard.actions as unknown[] | undefined;
  const print = dashboard.print as unknown[] | undefined;
  // Absent-when-undeclared parity: no [dashboard] tables, no dashboard key.
  if ((blocks?.length ?? 0) + (actions?.length ?? 0) + (print?.length ?? 0) > 0) {
    out.blocks = blocks ?? [];
    out.actions = actions ?? [];
    out.print = print ?? [];
    // Keep only the original row objects (already shape-checked above).
    manifest.dashboard = { blocks: blocks ?? [], actions: actions ?? [], print: print ?? [] };
  }
}

/**
 * Render a server manifest back to grouped toml (`app config link`).
 * The inverse of `toManifest` — same groups, same names.
 */
export function fromManifest(manifest: Record<string, unknown>): string {
  const doc: Record<string, unknown> = {};
  // No `version`: the toml never carries one (Shopify parity) — the linked
  // version is printed by `config link` itself.
  for (const key of ['slug', 'name', 'distribution', 'icon', 'developer', 'category']) {
    if (manifest[key] !== undefined) doc[key] = manifest[key];
  }
  const listing: Record<string, unknown> = {};
  for (const key of ['description', 'tagline', 'description_long', 'highlights', 'logo_url', 'pricing', 'developer_url', 'privacy_url', 'support_url', 'demo_url', 'video_url']) {
    if (manifest[key] !== undefined) listing[key] = manifest[key];
  }
  if (Object.keys(listing).length > 0) doc.listing = listing;
  doc.access = {
    scopes: manifest.scopes ?? [],
    ...(manifest.optional_scopes !== undefined ? { optional_scopes: manifest.optional_scopes } : {}),
  };
  const webhooks: Record<string, unknown> = {};
  if (manifest.webhook_topics !== undefined) webhooks.topics = manifest.webhook_topics;
  if (manifest.webhook_url !== undefined) webhooks.url = manifest.webhook_url;
  if (Object.keys(webhooks).length > 0) doc.webhooks = webhooks;
  const app: Record<string, unknown> = {};
  for (const [tomlKey, manifestKey] of [['install_url', 'install_url'], ['uninstall_url', 'uninstall_url'], ['settings_url', 'settings_url']] as const) {
    if (manifest[manifestKey] !== undefined) app[tomlKey] = manifest[manifestKey];
  }
  if (Object.keys(app).length > 0) doc.app = app;
  if (manifest.settings !== undefined) doc.settings = manifest.settings;
  if (manifest.extensions !== undefined) doc.extensions = manifest.extensions;
  if (manifest.dashboard !== undefined) doc.dashboard = manifest.dashboard;
  return `# queek.app.toml — local source of truth for \`queek app deploy\`. Secrets never live here.\n${stringifyToml(doc)}`;
}

/** Load + validate in one step: what every `app` command starts from. */
export function loadApp(dir: string, variant?: string): { path: string; manifest: AppManifest; warnings: string[]; dev?: DevTable } {
  const path = resolveTomlPath(dir, variant);
  const { doc } = loadTomlFile(path);
  const { manifest, warnings, dev } = toManifest(doc);
  return { path, manifest, warnings, ...(dev !== undefined ? { dev } : {}) };
}

/**
 * Keep the CLI-only `[dev]` table across `app config link --force`: link
 * rewrites the toml from the server manifest (which has no dev), so a
 * recorded table would otherwise be wiped. Returns the linked text with the
 * recorded `[dev]` appended, or the text unchanged when there is none.
 */
export function preserveDevTable(existingToml: string, linkedToml: string): string {
  let doc: unknown;
  try {
    doc = parseToml(existingToml);
  } catch {
    return linkedToml;
  }
  if (!isRecord(doc) || !isRecord(doc.dev)) return linkedToml;
  return `${linkedToml.trimEnd()}\n\n[dev]\n${stringifyToml(doc.dev as Record<string, unknown>).trimEnd()}\n`;
}

export function tomlFileName(variant?: string): string {
  return variant ? APP_TOML_VARIANT(variant) : APP_TOML;
}

/** Where `app dev`/`deploy` keep local-only state (never committed). */
export function queekDir(dir: string): string {
  return join(resolve(dir), '.queek');
}

/**
 * `[[extensions.nav]]` — the app's own menu, shown under the app in the
 * dashboard sidebar (Shopify's s-app-nav). Same rules the backend validator
 * applies, checked here so a mistake fails on the developer's machine: at
 * most 10 items, label 1–40 characters, path a relative "/…" inside the
 * merchant page's path (no "//", "\\", "..", scheme or encoded variants).
 */
function checkNav(nav: unknown, pageUrl: unknown, fail: (message: string) => never): Array<{ label: string; path: string }> {
  if (!Array.isArray(nav)) throw fail('The extensions.nav section must be a list of [[extensions.nav]] tables.');
  if (nav.length > 10) throw fail('The extensions.nav list must not have more than 10 items.');
  if (typeof pageUrl !== 'string') throw fail('extensions.nav needs extensions.merchant_page_url (the menu lives inside the merchant page).');
  let prefix = '';
  try {
    prefix = new URL(pageUrl).pathname.replace(/\/+$/, '');
  } catch {
    throw fail('extensions.merchant_page_url must be a valid https URL.');
  }
  return (nav as unknown[]).map((item, index) => {
    const where = `extensions.nav[${index}]`;
    if (!isRecord(item)) throw fail(`The ${where} entry must be a table with label and path.`);
    for (const key of Object.keys(item)) {
      if (!['label', 'path'].includes(key)) throw fail(`The ${where}.${key} field is not allowed (label, path).`);
    }
    const label = item.label;
    if (typeof label !== 'string' || label.trim() === '' || label.length > 40 || hasControlCharacter(label)) {
      throw fail(`The ${where}.label must be 1-40 characters.`);
    }
    const path = item.path;
    let decoded = typeof path === 'string' ? path : '';
    for (let round = 0; round < 5; round += 1) {
      try {
        const next = decodeURIComponent(decoded);
        if (next === decoded) break;
        decoded = next;
      } catch {
        break;
      }
    }
    const bad =
      typeof path !== 'string' ||
      !decoded.startsWith('/') ||
      decoded.startsWith('//') ||
      decoded.includes('\\') ||
      hasControlCharacter(decoded) ||
      /(^|\/)\.\.(\/|$)/.test(decoded) ||
      /^[a-z][a-z0-9+.-]*:/i.test(decoded);
    if (bad) throw fail(`The ${where}.path must be a relative path starting with "/" (no "//", "\\", "..", scheme or encoded variants).`);
    const pathOnly = decoded.split(/[?#]/)[0] ?? '';
    if (prefix !== '' && pathOnly !== prefix && !pathOnly.startsWith(`${prefix}/`)) {
      throw fail(`The ${where}.path must stay inside the merchant page (${prefix}).`);
    }
    return { label: label.trim(), path };
  });
}

function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
