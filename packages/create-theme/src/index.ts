import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { downloadTemplate } from 'giget';
import { UsageError, equivalentCommand, resolveAnswers, type Flags, type PackageManager, type Prompter } from './options.js';
import { setupTheme, type Answers } from './setup.js';

export { UsageError, CancelledError, type Flags, type Prompter, type PackageManager } from './options.js';
export { setupTheme, type Answers } from './setup.js';

const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
/** The starter this release was tested with: its tag matches this package's version (`yarn starter:publish --tag`). */
export const STARTER = `github:usequeek/theme-starter#v${VERSION}`;

export function detectPackageManager(userAgent = process.env.npm_config_user_agent ?? ''): PackageManager {
  const name = userAgent.split('/')[0];
  return name === 'pnpm' || name === 'yarn' || name === 'bun' ? name : 'npm';
}

export const HELP = `Create a Queek storefront theme.

  npm create @usequeek/theme@latest my-theme -- --templates laundry --tags minimal
  pnpm create @usequeek/theme my-theme --templates laundry --tags minimal

npm needs -- before these flags. In a terminal, anything you leave out is asked.

  --name <text>          theme name (default: the folder name)
  --templates <keys>     businesses to make templates for, comma-separated
  --primary <key>        the primary template (default: the first)
  --categories <keys>    business categories (default: the templates')
  --tags <tags>          1–6 tags for the look
  --pages <list|none>    extra pages: contact, faq (default: both)
  --ai <list>, --no-ai   AI assistants: claude, gemini (default: both; AGENTS.md always)
  --pm <npm|pnpm|yarn|bun>, --no-install, --no-git
  --yes, -y              accept every default, never prompt
  --dry-run              print what would be written; write nothing
  --force                allow a folder that is not empty
  --template <source>    another starter: a giget source or a local folder`;

function targetState(dir: string): 'missing' | 'usable' | 'busy' {
  if (!existsSync(dir)) return 'missing';
  if (!statSync(dir).isDirectory()) return 'busy';
  const entries = readdirSync(dir).filter((entry) => entry !== '.git');
  return entries.length === 0 ? 'usable' : 'busy';
}

async function fetchStarter(source: string, into: string): Promise<void> {
  const local = resolve(source);
  if (existsSync(local) && statSync(local).isDirectory()) {
    cpSync(local, into, { recursive: true, filter: (path) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(path) });
    return;
  }
  try {
    await downloadTemplate(source, { dir: into, force: true });
  } catch (error) {
    throw new Error(`Could not download the starter from ${source} (${(error as Error).message}). Check your connection, or pass --template github:usequeek/theme-starter for the latest.`);
  }
}

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path, root) : [relative(root, path).replace(/\\/g, '/')];
  }).sort();
}

export async function createTheme(dir: string, answers: Answers, options: { install: boolean; git: boolean; pm: PackageManager; dryRun: boolean; force: boolean; template?: string; log?: (line: string) => void }): Promise<void> {
  const log = options.log ?? ((line: string) => console.log(line));
  const target = resolve(dir);
  if (targetState(target) === 'busy' && !options.force) throw new UsageError(`${dir} is not empty. Choose another folder, or pass --force to write into it.`);

  const stage = mkdtempSync(join(tmpdir(), 'queek-theme-'));
  try {
    await fetchStarter(options.template ?? STARTER, stage);
    setupTheme(stage, answers);
    if (options.dryRun) {
      log(`Would create ${dir}:`);
      for (const file of listFiles(stage)) log(`  ${file}`);
      return;
    }
    cpSync(stage, target, { recursive: true });
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }

  const shown = relative(process.cwd(), target) || '.';
  if (options.install) {
    log(`Installing dependencies with ${options.pm}…`);
    const result = spawnSync(options.pm, ['install'], { cwd: target, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) throw new Error(`${options.pm} install failed. The theme is in ${shown}; run \`${options.pm} install\` there.`);
  }
  if (options.git) {
    const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: target, encoding: 'utf8' });
    if (inside.error) log('git is not installed; skipped git init.');
    else if (inside.status === 0 && !existsSync(join(target, '.git'))) log('Already inside a git repository; skipped git init.');
    else if (!existsSync(join(target, '.git'))) spawnSync('git', ['init', '-q'], { cwd: target });
  }

  const run = options.pm === 'npm' ? 'npm run' : options.pm;
  log('');
  log(`Created ${answers.name} in ${shown}. Next:`);
  log(`  cd ${shown}`);
  if (!options.install) log(`  ${options.pm} install`);
  log(`  ${run} dev     # preview every template`);
  log(`  ${run} check   # your to-do list: descriptions, each template's own home, your products and photos`);
  log('');
  log(`To repeat this setup: ${equivalentCommand(options.pm, dir, answers)}`);
}

/** Flags → answers (prompting when a prompter is given) → the theme. Shared by the CLI and `queek-theme init`. */
export async function runCreate(flags: Flags, prompter: Prompter | null, log?: (line: string) => void): Promise<void> {
  const answers = await resolveAnswers(flags, prompter);
  const pm = (flags.pm as PackageManager | undefined) ?? detectPackageManager();
  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(pm)) throw new UsageError(`--pm must be npm, pnpm, yarn or bun, not "${pm}".`);
  await createTheme(flags.dir ?? 'my-theme', answers, { install: flags.install, git: flags.git, pm, dryRun: flags.dryRun, force: flags.force, template: flags.template, log });
}
