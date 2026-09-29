import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { arch, platform, release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Flags } from '@oclif/core';
import { chromium } from 'playwright-core';
import {
  bundledVersion,
  designsOf,
  groupTemplates,
  loadContext,
  readCachedVocabulary,
  resolveVocabulary,
} from '@usequeek/theme-check';
import { BaseCommand } from '../lib/base-command.js';
import { FIRST_PREVIEW_PORT, pickPort } from '../lib/port.js';
import { resolveProject } from '../lib/project.js';

/** Where `queek theme info` points people for the full guides. */
export const GUIDES_URL = 'https://docs.usequeek.com/docs/themes';
/** Where it points people for the check reference. */
export const CHECK_GUIDES_URL = 'https://docs.usequeek.com/docs/themes/checks';

type RequireFn = ReturnType<typeof createRequire>;

/** Read and parse a JSON file, or null when it cannot be read or parsed. */
function readJson(path: string): { version?: unknown; peerDependencies?: unknown } | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown; peerDependencies?: unknown };
  } catch {
    return null;
  }
}

/**
 * The installed version of `spec`, resolved from what is actually loaded
 * (the same `node_modules` chain the running code resolves it from).
 * `<spec>/package.json` first; when the package's exports map hides that
 * subpath, the entry point is resolved and walked up to the owning
 * package.json instead. Null when it is not installed.
 */
export function installedVersion(requireFrom: RequireFn, spec: string): string | null {
  try {
    const pkg = readJson(requireFrom.resolve(`${spec}/package.json`));
    return typeof pkg?.version === 'string' ? pkg.version : null;
  } catch {
    // The exports map hides ./package.json — fall through to the walk-up.
  }
  try {
    let dir = dirname(requireFrom.resolve(spec));
    for (let depth = 0; depth < 6; depth++) {
      const pkg = readJson(join(dir, 'package.json'));
      if (pkg !== null) {
        return typeof pkg.version === 'string' ? pkg.version : null;
      }
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch {
    // Not installed.
  }
  return null;
}

/** The CLI's own package.json: where the peer ranges below come from. */
function cliPackageJson(requireFrom: RequireFn): { version?: unknown; peerDependencies?: unknown } | null {
  try {
    return readJson(requireFrom.resolve('@usequeek/cli/package.json'));
  } catch {
    return readJson(resolve(dirname(new URL(import.meta.url).pathname), '../../package.json'));
  }
}

type Triple = [number, number, number];

function parseVersion(version: string): Triple | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareTriple(a: Triple, b: Triple): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Whether an installed version satisfies a peer range. Covers the shapes the
 * CLI's own peerDependencies use (`^x.y.z`, `>=x.y.z`, exact); null for a
 * range shape this does not understand or a version it cannot parse.
 */
export function satisfiesPeerRange(version: string, range: string): boolean | null {
  const parsed = parseVersion(version);
  const wanted = range.trim();
  if (parsed === null) return null;
  if (wanted.startsWith('>=')) {
    const base = parseVersion(wanted.slice(2).trim());
    return base === null ? null : compareTriple(parsed, base) >= 0;
  }
  if (wanted.startsWith('^')) {
    const base = parseVersion(wanted.slice(1).trim());
    // `^0.x` pins the minor the way npm does; `^x.y.z` pins the major.
    if (base === null) return null;
    if (base[0] === 0) return parsed[0] === 0 && parsed[1] === base[1] && compareTriple(parsed, base) >= 0;
    return parsed[0] === base[0] && compareTriple(parsed, base) >= 0;
  }
  if (wanted.startsWith('~')) {
    const base = parseVersion(wanted.slice(1).trim());
    return base === null ? null : parsed[0] === base[0] && parsed[1] === base[1] && compareTriple(parsed, base) >= 0;
  }
  const base = parseVersion(wanted);
  return base === null ? null : compareTriple(parsed, base) === 0;
}

/** The package manager that owns the project: whichever lockfile is present. */
export function detectLockfileManager(root: string): string {
  const candidates: Array<[string, string]> = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
    ['bun.lockb', 'bun'],
    ['bun.lock', 'bun'],
  ];
  for (const [file, manager] of candidates) {
    if (existsSync(join(root, file))) return manager;
  }
  return 'none (no lockfile)';
}

export interface BrowserPath {
  path: string;
  exists: boolean;
}

/**
 * The well-known Chrome and Edge install paths per OS, checked for existence
 * only — never launched. `platform` and `env` are injectable for tests.
 */
export function knownBrowserPaths(
  os: NodeJS.Platform = platform(),
  env: NodeJS.ProcessEnv = process.env,
): { chrome: BrowserPath[]; edge: BrowserPath[] } {
  const paths: { chrome: string[]; edge: string[] } =
    os === 'darwin'
      ? {
          chrome: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
          edge: ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
        }
      : os === 'win32'
        ? {
            chrome: ['Google/Chrome/Application/chrome.exe'],
            edge: ['Microsoft/Edge/Application/msedge.exe'],
          }
        : {
            chrome: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'],
            edge: ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable', '/opt/microsoft/msedge/msedge'],
          };
  const check = (path: string): BrowserPath => ({ path, exists: existsSync(path) });
  if (os === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(
      (root): root is string => typeof root === 'string' && root.length > 0,
    );
    const expand = (relative: string[]): BrowserPath[] =>
      roots.flatMap((root) => relative.map((rel) => join(root, rel))).map(check);
    return { chrome: expand(paths.chrome), edge: expand(paths.edge) };
  }
  return { chrome: paths.chrome.map(check), edge: paths.edge.map(check) };
}

/** Playwright's own chromium executable: its path and whether it is installed. Never launches. */
export function playwrightChromium(): { path: string | null; exists: boolean | null } {
  try {
    const path = chromium.executablePath();
    if (typeof path !== 'string' || path.length === 0) return { path: null, exists: null };
    return { path, exists: existsSync(path) };
  } catch {
    return { path: null, exists: null };
  }
}

/** A CI-ish env value counts when set to anything but `''`/`'false'`/`'0'`. */
const isSet = (value: string | undefined): boolean =>
  value !== undefined && value !== '' && value !== 'false' && value !== '0';

/** Whether the new-version notice is off, and why — the same inputs `applyUpdateCheckEnv` reads. */
export function updateCheckStatus(env: NodeJS.ProcessEnv = process.env): { off: boolean; reason: string } {
  if (isSet(env.CI)) return { off: true, reason: `off (CI=${env.CI})` };
  if (isSet(env.QUEEK_NO_UPDATE_CHECK)) return { off: true, reason: `off (QUEEK_NO_UPDATE_CHECK=${env.QUEEK_NO_UPDATE_CHECK})` };
  return { off: false, reason: 'on' };
}

export interface InfoFrameworkEntry {
  version: string | null;
  wanted: string;
  supported: boolean | null;
}

export interface InfoReport {
  tools: { cli: string; themeCheck: string; createTheme: string; node: string; os: string; arch: string };
  project:
    | {
        root: string;
        themeDir: string;
        slug: string;
        name: string;
        templates: { count: number; ids: string[] };
        designs: { count: number; ids: string[] };
        packageManager: string;
      }
    | null;
  projectNote: string | null;
  framework: Record<string, InfoFrameworkEntry>;
  vocabulary: { source: string; version: string; notice?: string };
  port: number;
  portDefaultFree: boolean;
  browser: {
    env: { value: string | null; exists: boolean | null };
    chromium: { path: string | null; exists: boolean | null };
    chrome: BrowserPath[];
    edge: BrowserPath[];
  };
  updateCheck: { off: boolean; reason: string };
}

/** Label/value rows under one heading, labels padded to one width. */
function section(heading: string, rows: Array<[string, string]>): string[] {
  const width = Math.max(...rows.map(([label]) => label.length));
  return [heading, ...rows.map(([label, value]) => `  ${label.padEnd(width)}  ${value}`)];
}

const show = (value: string | null): string => value ?? '(not installed)';
const tick = (exists: boolean | null): string => (exists === true ? 'found' : exists === false ? 'missing' : 'unknown');

/** The plain-text report: aligned `label  value` lines under short headings. */
export function formatInfo(report: InfoReport): string {
  const lines: string[] = [];
  lines.push(
    ...section('Tools', [
      ['cli', show(report.tools.cli)],
      ['theme-check', show(report.tools.themeCheck)],
      ['create-theme', show(report.tools.createTheme)],
      ['node', report.tools.node],
      ['os', `${report.tools.os} ${report.tools.arch}`],
    ]),
    '',
  );
  if (report.project === null) {
    lines.push(...section('Project', [['status', report.projectNote ?? 'not a theme project']]), '');
  } else {
    const { project } = report;
    lines.push(
      ...section('Project', [
        ['root', project.root],
        ['theme', project.themeDir],
        ['slug', project.slug],
        ['name', project.name],
        ['templates', `${project.templates.count} (${project.templates.ids.join(', ') || 'none'})`],
        ['designs', `${project.designs.count} (${project.designs.ids.join(', ') || 'none'})`],
        ['package-manager', project.packageManager],
      ]),
      '',
    );
  }
  lines.push(
    ...section(
      'Framework',
      Object.entries(report.framework).map(([name, entry]) => [
        name,
        entry.version === null
          ? `(not installed; wants ${entry.wanted})`
          : entry.supported === false
            ? `${entry.version} (outside the CLI's ${entry.wanted} peer range)`
            : entry.version,
      ]),
    ),
    '',
    ...section('Vocabulary', [
      ['source', report.vocabulary.source],
      ['version', report.vocabulary.version],
    ]),
    '',
    ...section('Port', [
      ['7833', report.portDefaultFree ? 'free' : `busy, using ${report.port}`],
      ...(report.portDefaultFree ? [] as Array<[string, string]> : [['use', String(report.port)] as [string, string]]),
    ]),
    '',
    ...section('Browser', [
      ['QUEEK_THEME_BROWSER', report.browser.env.value ?? '(unset)'],
      ['chromium', report.browser.chromium.path === null ? '(unknown)' : `${tick(report.browser.chromium.exists)} ${report.browser.chromium.path}`],
      ...report.browser.chrome.map((candidate) => ['chrome', `${tick(candidate.exists)} ${candidate.path}`] as [string, string]),
      ...report.browser.edge.map((candidate) => ['edge', `${tick(candidate.exists)} ${candidate.path}`] as [string, string]),
    ]),
    '',
    ...section('Update check', [['status', report.updateCheck.reason]]),
  );
  return lines.join('\n');
}

export default class Info extends BaseCommand {
  static override summary = 'Print what a bug report needs: tools, project, framework, vocabulary, port and browser.';

  static override description = `Everything someone needs to answer "why doesn't it work for me?", in one paste. Never launches a browser and never touches the network unless --online is passed.

Exit 0 even outside a theme project (the Project section says so); exit 2 only on an internal error.`;

  static override examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --json'];

  static override flags = {
    path: Flags.string({ summary: 'The theme project (or its theme folder).', default: '.', env: 'QUEEK_THEME_PATH' }),
    online: Flags.boolean({ summary: 'Allow the network when resolving the vocabulary.', default: false }),
  };

  async run(): Promise<Record<string, unknown> | void> {
    const { flags } = await this.parse(Info);
    this.setVerbose(flags.verbose as boolean | undefined);
    const json = (flags as { json?: boolean }).json === true;

    try {
      const report = await collectInfo({ path: flags.path, online: flags.online });
      if (json) return report as unknown as Record<string, unknown>;
      this.log(formatInfo(report));
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }
  }
}

/** Gather every section. Only `resolveProject` failing means "not a theme project" (exit 0); anything else throws. */
export async function collectInfo(options: { path: string; online: boolean }): Promise<InfoReport> {
  const requireFromCli = createRequire(import.meta.url);
  const cliPkg = cliPackageJson(requireFromCli);
  const peers = (cliPkg?.peerDependencies ?? {}) as Record<string, string>;

  const tools: InfoReport['tools'] = {
    cli: installedVersion(requireFromCli, '@usequeek/cli') ?? 'unknown',
    themeCheck: installedVersion(requireFromCli, '@usequeek/theme-check') ?? 'unknown',
    createTheme: installedVersion(requireFromCli, '@usequeek/create-theme') ?? 'unknown',
    node: process.version,
    os: `${platform()} ${release()}`,
    arch: arch(),
  };

  let root = resolve(options.path);
  let themeDir: string | null = null;
  let projectNote: string | null = null;
  try {
    const project = resolveProject(options.path);
    root = project.root;
    themeDir = project.themeDir;
  } catch (error) {
    projectNote = (error as Error).message;
  }

  let project: InfoReport['project'] = null;
  if (themeDir !== null) {
    const context = await loadContext(themeDir);
    const config = (context.themeConfig ?? {}) as { name?: unknown };
    const designs = designsOf(config as Parameters<typeof designsOf>[0]);
    const templates = groupTemplates(designs);
    project = {
      root,
      themeDir,
      slug: context.slug,
      name: typeof config.name === 'string' && config.name.length > 0 ? config.name : context.slug,
      templates: { count: templates.length, ids: templates.map((template) => template.key ?? '(none)') },
      designs: { count: designs.length, ids: designs.map((design) => design.id) },
      packageManager: detectLockfileManager(root),
    };
  } else {
    try {
      if (!existsSync(root)) root = process.cwd();
    } catch {
      root = process.cwd();
    }
  }

  const requireFromProject = createRequire(join(root, 'package.json'));
  const frameworkNames = ['next', 'react', 'react-dom', '@usequeek/theme-kit'];
  const framework: InfoReport['framework'] = {};
  for (const name of frameworkNames) {
    const version = installedVersion(requireFromProject, name);
    const wanted = typeof peers[name] === 'string' ? peers[name] : 'unknown';
    framework[name] = {
      version,
      wanted,
      supported: version === null || wanted === 'unknown' ? null : satisfiesPeerRange(version, wanted),
    };
  }

  let vocabulary: InfoReport['vocabulary'];
  if (options.online) {
    const resolved = await resolveVocabulary({ mode: 'live' });
    vocabulary = resolved.notice
      ? { source: resolved.source, version: resolved.version, notice: resolved.notice }
      : { source: resolved.source, version: resolved.version };
  } else {
    const cached = readCachedVocabulary();
    vocabulary =
      cached?.version !== undefined && typeof cached.version === 'string'
        ? { source: 'cache', version: cached.version }
        : { source: 'bundled', version: bundledVersion() };
  }

  let port = FIRST_PREVIEW_PORT;
  let portDefaultFree = true;
  try {
    await pickPort({ host: '127.0.0.1', requested: FIRST_PREVIEW_PORT });
  } catch {
    portDefaultFree = false;
    port = await pickPort({ host: '127.0.0.1' });
  }

  const envBrowser = process.env.QUEEK_THEME_BROWSER;
  const known = knownBrowserPaths();
  const browser: InfoReport['browser'] = {
    env: {
      value: envBrowser ?? null,
      exists: envBrowser === undefined ? null : existsSync(envBrowser),
    },
    chromium: playwrightChromium(),
    chrome: known.chrome,
    edge: known.edge,
  };

  return {
    tools,
    project,
    projectNote,
    framework,
    vocabulary,
    port,
    portDefaultFree,
    browser,
    updateCheck: updateCheckStatus(),
  };
}
