import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { downloadTemplate } from 'giget';
import { slugify } from './naming.js';
import { UsageError, type PackageManager } from './options.js';

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
        .replace(/^export const DEFAULT_BASE_URL = ".*";/m, `export const DEFAULT_BASE_URL = "https://${answers.slug}.apps.queek.com.ng";`),
    );
  }

  const pkgFile = join(stage, 'package.json');
  if (existsSync(pkgFile)) {
    const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as { name?: string };
    pkg.name = answers.slug;
    writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
  }
  const readme = join(stage, 'README.md');
  if (existsSync(readme)) {
    writeFileSync(readme, readFileSync(readme, 'utf8').replace(/^# .*/m, `# ${answers.name}`));
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

/** Fetch the starter (pinned GitHub template, `--template`, or a local folder) into `into`. */
export async function fetchStarter(into: string, template: string | undefined, starter: string): Promise<string> {
  const source = template ?? starter;
  if (existsSync(source) && statSync(source).isDirectory()) {
    cpSync(source, into, { recursive: true });
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
    cpSync(stage, resolve(dir), { recursive: true });
    options.log?.(`Created ${dir} from ${from} as "${answers.slug}".`);
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
