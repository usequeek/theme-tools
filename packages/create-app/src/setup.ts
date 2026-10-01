import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { downloadTemplate } from 'giget';
import { slugify } from './naming.js';
import { UsageError, type PackageManager } from './options.js';

/** The Queek developer docs every scaffolded file points at (the MCP ships later — never invented here). */
export const QUEEK_DOCS_URL = 'https://docs.usequeek.com';

/**
 * What every `npm create @usequeek/app` output ships (Shopify item 15
 * parity): how an agent builds a Queek app — SDK, toml, dev loop, docs, MCP
 * status, and the no-new-tooling rule. The scaffolder owns this text so a
 * drifting template branch can never drop it.
 */
export function agentsMd(): string {
  return `# Building this Queek app

You are working in a Queek installable app (scaffolded by \`@usequeek/create-app\`).

- SDK: \`@usequeek/app-sdk\` — install/uninstall/settings/webhooks handlers live in \`src/\`. The SDK README in \`node_modules/@usequeek/app-sdk\` is the handler contract.
- Config: \`queek.app.toml\` IS the app — scopes (\`[access]\`), webhook topics (\`[webhooks]\`), app URLs (\`[app]\`), merchant settings (\`[[settings]]\`). \`queek app config link\` pulls the live config into the file; \`queek app deploy\` validates the whole config server-side and releases a version.
- Dev loop: \`queek app dev\` — creates a dev store with test data when you have none, then tunnels, installs (scopes auto-granted, no consent screen) and watches. \`queek app info\` shows the current configuration.
- Docs: ${QUEEK_DOCS_URL} — the reference for the manifest, scopes, webhooks and the review submission flow.
- Queek MCP: not published yet. \`.mcp.json\` (and \`.cursor/mcp.json\`) is the standard location — wire the Queek MCP there when it ships; until then use the docs above.

Do not add tooling to this repo: no new build systems, linters, formatters, test frameworks or CI beyond what the starter ships. Fix the app, not the scaffold.
`;
}

/** `CLAUDE.md` is exactly the pointer — one line, no trailing prose. */
export const CLAUDE_MD = '@AGENTS.md';

/**
 * The MCP wiring location, shipped from day one. No developer MCP server
 * exists in the repos yet, so this wires nothing invented — an empty
 * `mcpServers` object the Queek MCP lands in when it publishes.
 */
export function mcpJson(): string {
  return `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`;
}

/** The success banner: next steps plus the AI setup (AGENTS.md + docs + MCP location). */
export function successBanner(dir: string): string {
  return [
    `Next steps:`,
    `  cd ${dir}`,
    `  queek app dev          # creates a dev store if you have none, then tunnels + installs + watches`,
    `AI assistants: AGENTS.md points at the Queek docs (${QUEEK_DOCS_URL}); .mcp.json is ready for the Queek MCP when it ships — do not add tooling to this repo.`,
  ].join('\n');
}

/** Write the agent files every scaffolded app ships (overwrites template drift — the scaffolder owns them). */
export function setupAgentFiles(stage: string): void {
  writeFileSync(join(stage, 'AGENTS.md'), agentsMd());
  writeFileSync(join(stage, 'CLAUDE.md'), CLAUDE_MD);
  writeFileSync(join(stage, '.mcp.json'), mcpJson());
  mkdirSync(join(stage, '.cursor'), { recursive: true });
  writeFileSync(join(stage, '.cursor', 'mcp.json'), mcpJson());
}

export interface Answers {
  slug: string;
  name: string;
}

/**
 * Turn a downloaded starter into the developer's app. Pure file work:
 * the slug lands in queek.app.toml + package.json (+ README title);
 * no network, no install.
 */
export function setupApp(stage: string, answers: Answers): { files: string[] } {
  const toml = join(stage, 'queek.app.toml');
  if (!existsSync(toml)) throw new UsageError('The starter has no queek.app.toml — is it a Queek app starter?');
  const before = readFileSync(toml, 'utf8');
  const renamed = before
    .replace(/^slug = ".*"/m, `slug = "${answers.slug}"`)
    .replace(/^handle = ".*"/m, `slug = "${answers.slug}"`)
    .replace(/^name = ".*"/m, `name = "${answers.name}"`)
    // The starter's default host is slug-based (<slug>.apps.queek.com.ng).
    .replaceAll('https://my-app.apps.queek.com.ng', `https://${answers.slug}.apps.queek.com.ng`);
  writeFileSync(toml, renamed);

  const configFile = join(stage, 'src', 'config.ts');
  if (existsSync(configFile)) {
    const configBefore = readFileSync(configFile, 'utf8');
    writeFileSync(
      configFile,
      configBefore
        .replace(/^export const APP_SLUG = ".*";/m, `export const APP_SLUG = "${answers.slug}";`)
        .replace(/^export const DEFAULT_BASE_URL = ".*";/m, `export const DEFAULT_BASE_URL = "https://${answers.slug}.apps.queek.com.ng";`)
        .replaceAll('"./data/my-app.db"', `"./data/${answers.slug}.db"`),
    );
  }

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
  const readme = join(stage, 'README.md');
  if (existsSync(readme)) {
    writeFileSync(
      readme,
      readFileSync(readme, 'utf8')
        .replace(/^# .*/m, `# ${answers.name}`)
        .replaceAll('my-app.apps.queek.com.ng', `${answers.slug}.apps.queek.com.ng`),
    );
  }
  const dockerfile = join(stage, 'Dockerfile');
  if (existsSync(dockerfile)) {
    writeFileSync(dockerfile, readFileSync(dockerfile, 'utf8').replace('docker build -t my-app', `docker build -t ${answers.slug}`));
  }
  // The dev database path bakes the template slug in three places.
  for (const file of ['Dockerfile', '.env.example'] as const) {
    const target = join(stage, file);
    if (existsSync(target)) {
      writeFileSync(target, readFileSync(target, 'utf8').replaceAll('my-app.db', `${answers.slug}.db`));
    }
  }
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
 * these (a 123 MB node_modules, a foreign .git); the GitHub tarball never
 * does. `.env` stays behind, `.env.example` ships.
 */
const STAGE_DENY = new Set(['.git', 'node_modules', 'dist', 'data', '.queek', '.env']);

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
