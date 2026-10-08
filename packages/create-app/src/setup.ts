import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { downloadTemplate } from 'giget';
import { nameProblem, slugify } from './naming.js';
import { UsageError, type PackageManager } from './options.js';

/** The Queek developer docs every scaffolded file points at. */
export const QUEEK_DOCS_URL = 'https://docs.usequeek.com';

/**
 * The agent files every `npm create @usequeek/app` output ships. `AGENTS.md`
 * and `CLAUDE.md` are the starter's own files, copied verbatim — the
 * starter repo is the single source of truth, so no second scaffolder copy
 * can drift stale. The scaffolder never rewrites them; it only guarantees
 * they exist and adds the MCP wiring location below.
 */

/** The MCP wiring location: an empty `mcpServers` object, the file where the Queek MCP is configured. */
export function mcpJson(): string {
  return `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`;
}

/** The success banner: next steps plus the AI setup (starter AGENTS.md + MCP location). */
export function successBanner(dir: string): string {
  return [
    `Next steps:`,
    `  cd ${dir}`,
    `  queek app dev          # creates a dev store if you have none, then tunnels + installs + watches`,
    `AI assistants: AGENTS.md ships verbatim from the starter (toolkit capacity check first, then the live Merchant spec); .mcp.json is where the Queek MCP is configured.`,
  ].join('\n');
}

/**
 * Ship the agent files every scaffolded app carries. The starter's
 * `AGENTS.md`/`CLAUDE.md` pass through byte-identical (a missing file is a
 * hard error, never a fallback to scaffolder-owned text); only the MCP
 * wiring is scaffolder-owned.
 */
export function setupAgentFiles(stage: string): void {
  for (const file of ['AGENTS.md', 'CLAUDE.md'] as const) {
    if (!existsSync(join(stage, file))) {
      throw new UsageError(`The starter has no ${file} — is it a Queek app starter?`);
    }
  }
  writeFileSync(join(stage, '.mcp.json'), mcpJson());
  mkdirSync(join(stage, '.cursor'), { recursive: true });
  writeFileSync(join(stage, '.cursor', 'mcp.json'), mcpJson());
}

export interface Answers {
  slug: string;
  name: string;
}

/**
 * The template identity baked into the starter (`my-app` / `My App`). The
 * starter repo keeps its own working values so its suite is green on main;
 * the sweep below renames every occurrence so no scaffolded file — app
 * code, env, Dockerfile, README, agent files, or test fixtures — keeps the
 * template identity (APP_SLUG feeds the app credential, so a leftover is a
 * runtime bug, not cosmetics).
 */
const TEMPLATE_SLUG = 'my-app';
const TEMPLATE_NAME = 'My App';

/**
 * Quote a display name as a TOML basic string. Inside a single-line basic
 * string only `"` and `\` are special (control characters are rejected by
 * nameProblem), so those two escapes are complete.
 */
export function tomlString(value: string): string {
  return `"${value.replaceAll('\\', () => '\\\\').replaceAll('"', () => '\\"')}"`;
}

/**
 * Escape a display name for the file it lands in. The template puts
 * `My App` in: TOML (`name = "…"`), JSON strings, JS/TS string literals,
 * TSX markup (JSX text and attribute strings, where HTML entities decode),
 * and plain text (markdown, env, logs). Every branch uses a replacer
 * function, so `$&`, `$'`, `$1` in the name stay literal.
 */
export function nameForFile(file: string, name: string): string {
  if (file.endsWith('.toml')) {
    return name.replaceAll('\\', () => '\\\\').replaceAll('"', () => '\\"');
  }
  if (file.endsWith('.json')) {
    return name.replaceAll('\\', () => '\\\\').replaceAll('"', () => '\\"');
  }
  if (file.endsWith('.tsx') || file.endsWith('.jsx') || file.endsWith('.html')) {
    return name
      .replaceAll('&', () => '&amp;')
      .replaceAll('<', () => '&lt;')
      .replaceAll('>', () => '&gt;')
      .replaceAll('"', () => '&quot;');
  }
  if (/\.[cm]?[jt]s$/.test(file)) {
    return name
      .replaceAll('\\', () => '\\\\')
      .replaceAll('"', () => '\\"')
      .replaceAll('`', () => '\\`')
      .replaceAll('${', () => '\\${');
  }
  return name;
}

/**
 * Rename the template identity across every staged text file (binary files —
 * images, fonts, archives — are skipped via a null-byte check). One token,
 * one pass: future starter files are covered without a per-file rule. The
 * slug is interpolated with a replacer function even though slugs are
 * validated — `$` patterns must never resurrect the template.
 */
export function sweepTemplateIdentity(stage: string, slug: string, name: string): void {
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (STAGE_DENY.has(entry.name)) continue;
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const bytes = readFileSync(full);
      if (bytes.includes(0)) continue;
      const text = bytes.toString('utf8');
      if (!text.includes(TEMPLATE_SLUG) && !text.includes(TEMPLATE_NAME)) continue;
      writeFileSync(
        full,
        text.replaceAll(TEMPLATE_SLUG, () => slug).replaceAll(TEMPLATE_NAME, () => nameForFile(full, name)),
      );
    }
  };
  walk(stage);
}

/**
 * Turn a downloaded starter into the developer's app. Pure file work:
 * structural edits (toml slug/name keys, package/lock names) plus the
 * template-identity sweep over every staged file; no network, no install.
 */
export function setupApp(stage: string, answers: Answers): { files: string[] } {
  const toml = join(stage, 'queek.app.toml');
  if (!existsSync(toml)) throw new UsageError('The starter has no queek.app.toml — is it a Queek app starter?');
  // The sweep's third application of nameProblem: a direct setupApp caller
  // bypasses --name and the prompt, so validate here too (ONE rule, three
  // call sites). The name is trimmed for use; the slug stays runCreate's.
  const name = answers.name.trim();
  const nameIssue = nameProblem(name);
  if (nameIssue) throw new UsageError(`${nameIssue} (pass --name).`);
  const before = readFileSync(toml, 'utf8');
  // Replacer functions throughout: a display name holding `$&`, `$'` or
  // `$1` must land literally, never as a replacement pattern. A starter
  // carrying both `slug` and legacy `handle` keeps exactly one `slug`
  // line — the legacy key is dropped instead of duplicated.
  const hasSlug = /^slug = ".*"/m.test(before);
  const renamed = before
    .replace(/^slug = ".*"/m, () => `slug = "${answers.slug}"`)
    .replace(/^handle = ".*"(?:\r?\n|$)/m, () => (hasSlug ? '' : `slug = "${answers.slug}"\n`))
    .replace(/^name = ".*"/m, () => `name = ${tomlString(name)}`);
  writeFileSync(toml, renamed);

  const pkgFile = join(stage, 'package.json');
  if (existsSync(pkgFile)) {
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as { name?: string };
    pkg.name = answers.slug;
    writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  // A staged lockfile keeps the template's pinned tree; only its root name
  // follows the rename (`npm install` would rewrite it anyway).
  const lockFile = join(stage, 'package-lock.json');
  if (existsSync(lockFile)) {
    const lock = JSON.parse(readFileSync(lockFile, 'utf8')) as { name?: unknown; packages?: Record<string, { name?: unknown }> };
    lock.name = answers.slug;
    if (lock.packages?.['']) lock.packages[''].name = answers.slug;
    writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
  }
  sweepTemplateIdentity(stage, answers.slug, name);
  const files = readdirSync(stage).sort();
  return { files };
}

export interface CreateOptions {
  install: boolean;
  git: boolean;
  pm: PackageManager;
  dryRun: boolean;
  force: boolean;
  template?: string;
  log?: (line: string) => void;
}

/**
 * Never scaffolded: VCS history, installed dependencies, build output, local
 * data and secrets. A local `--template` folder usually contains all of
 * these (a 123 MB node_modules, a foreign .git, a stale `build/`); the
 * GitHub tarball never does. `.env` stays behind, `.env.example` ships.
 */
const STAGE_DENY = new Set([
  '.git', 'node_modules', 'dist', 'build', 'dist-admin', '.react-router', 'data', '.queek', '.env',
]);

function stageable(path: string): boolean {
  const base = basename(path);
  if (STAGE_DENY.has(base)) return false;
  if (/\.db(-wal|-shm)?$/.test(base)) return false;
  return true;
}

/** Fetch the starter (pinned GitHub template, `--template`, or a local folder) into `into`. */
export async function fetchStarter(into: string, template: string | undefined, starter: string): Promise<string> {
  const source = template ?? starter;
  if (existsSync(source) && statSync(source).isDirectory()) {
    cpSync(source, into, { recursive: true, filter: stageable });
    return `local folder ${source}`;
  }
  try {
    await downloadTemplate(source, { dir: into, force: true });
  } catch (error) {
    throw new Error(`Could not download the starter from ${source} (${(error as Error).message}). Check your connection, or pass --template ${starter} for the latest.`);
  }
  return source;
}

function run(cmd: string, args: string[], cwd: string, log?: (line: string) => void): void {
  log?.(`$ ${cmd} ${args.join(' ')}`);
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed.`);
}

export async function createApp(dir: string, answers: Answers, options: CreateOptions): Promise<void> {
  const { STARTER } = await import('./index.js');
  if (options.dryRun) {
    options.log?.(`Would create ${dir} from the starter as slug "${answers.slug}" (${answers.name}).`);
    return;
  }
  const stage = mkdtempSync(join(tmpdir(), 'create-queek-app-'));
  try {
    const from = await fetchStarter(stage, options.template, STARTER);
    setupApp(stage, answers);
    setupAgentFiles(stage);
    cpSync(stage, resolve(dir), { recursive: true });
    options.log?.(`Created ${dir} from ${from} as "${answers.slug}".`);
    options.log?.(successBanner(dir));
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
  const target = resolve(dir);
  if (options.install) {
    const args = options.pm === 'yarn' ? [] : options.pm === 'bun' ? ['install'] : ['install'];
    run(options.pm, args, target, options.log);
  }
  if (options.git) {
    run('git', ['init'], target, options.log);
  }
}

export function defaultSlug(dir: string): string {
  return slugify(basename(resolve(dir))) || 'my-app';
}

/**
 * Minimum Node for the scaffolded app: the SDK stores installations in
 * `node:sqlite`, stable since Node 22.14 (on older 22.x the app's tests die
 * with "No such built-in module: node:sqlite"). Checked up front so the
 * developer learns before scaffolding, not after the first test run.
 */
export const REQUIRED_NODE_MAJOR = 22;
export const REQUIRED_NODE_MINOR = 14;

/** Null when `version` (default: this process) can run the scaffolded app. */
export function nodeVersionProblem(version: string = process.version): string | null {
  const match = /^v?(\d+)\.(\d+)\.\d+/.exec(version.trim());
  if (!match) return `Cannot parse Node version ${JSON.stringify(version)} — install Node >= 22.14 and re-run.`;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major > REQUIRED_NODE_MAJOR || (major === REQUIRED_NODE_MAJOR && minor >= REQUIRED_NODE_MINOR)) {
    return null;
  }
  return (
    `Scaffolding needs Node >= 22.14 but you have ${version}: the app SDK stores installations ` +
    `in node:sqlite (stable since 22.14). Switch with 'nvm install 22 && nvm use 22' (or your ` +
    `version manager), then re-run.`
  );
}

/** Throw before anything is asked or written when Node is too old. */
export function assertNodeVersion(version: string = process.version): void {
  const problem = nodeVersionProblem(version);
  if (problem) throw new Error(problem);
}
