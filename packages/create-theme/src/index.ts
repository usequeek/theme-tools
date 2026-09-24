import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { downloadTemplate } from 'giget';
import { UsageError, equivalentCommand, resolveAnswers, type Flags, type PackageManager, type Prompter } from './options.js';
import { setupTheme, type Answers } from './setup.js';

export { UsageError, CancelledError, type Flags, type Prompter, type PackageManager } from './options.js';
export { setupTheme, type Answers } from './setup.js';
export { clackPrompter } from './prompts.js';

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
  --ai <list>, --no-ai   AI assistants: claude, gemini (default: both; AGENTS.md unless --no-ai)
  --pm <npm|pnpm|yarn|bun>, --no-install, --no-git
  --yes, -y              accept every default, never prompt
  --dry-run              print what would be written; write nothing
  --force                allow a folder that is not empty
  --template <source>    another starter: a giget source or a local folder`;

function targetState(dir: string): 'missing' | 'usable' | 'busy' | 'file' {
  if (!existsSync(dir)) return 'missing';
  if (!statSync(dir).isDirectory()) return 'file';
  const entries = readdirSync(dir).filter((entry) => entry !== '.git');
  return entries.length === 0 ? 'usable' : 'busy';
}

/** Resolves `dir`, and throws before anything is asked or written when it cannot be used. */
function checkTarget(dir: string, force: boolean): { target: string; state: 'missing' | 'usable' | 'busy' } {
  const target = resolve(dir);
  const state = targetState(target);
  if (state === 'file') throw new UsageError(`${dir} is a file, not a folder. Choose another name.`);
  if (state === 'busy' && !force) throw new UsageError(`${dir} is not empty. Choose another folder, or pass --force to write into it.`);
  return { target, state };
}

/** `lstatSync`, or null if nothing is there — never follows a symlink, unlike `existsSync`/`statSync`. */
function lstatOrNull(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

/**
 * Paths (relative to `stage`) where writing the starter into `target` is unsafe: the
 * target already has the other type (a file where the stage has a folder, or the
 * reverse) — cpSync cannot merge these — or the target is a symlink, dangling or not:
 * `existsSync` follows symlinks, so a dangling one reads as "nothing here" right up
 * until Node's native cpSync tries to write through it and aborts the whole process.
 */
function conflictingPaths(stage: string, target: string, root = ''): string[] {
  const conflicts: string[] = [];
  for (const name of readdirSync(stage)) {
    const stagePath = join(stage, name);
    const targetPath = join(target, name);
    const relPath = root ? `${root}/${name}` : name;
    const targetStat = lstatOrNull(targetPath);
    if (!targetStat) continue;
    if (targetStat.isSymbolicLink()) {
      conflicts.push(`${relPath} (a link)`);
      continue;
    }
    const stageIsDir = statSync(stagePath).isDirectory();
    const targetIsDir = targetStat.isDirectory();
    if (stageIsDir !== targetIsDir) conflicts.push(relPath);
    else if (stageIsDir) conflicts.push(...conflictingPaths(stagePath, targetPath, relPath));
  }
  return conflicts;
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
  const { target, state } = checkTarget(dir, options.force);

  const stage = mkdtempSync(join(tmpdir(), 'queek-theme-'));
  try {
    await fetchStarter(options.template ?? STARTER, stage);
    setupTheme(stage, answers);
    if (options.dryRun) {
      log(`Would create ${dir}:`);
      for (const file of listFiles(stage)) log(`  ${file}`);
      return;
    }
    if (state === 'busy') {
      const conflicts = conflictingPaths(stage, target);
      if (conflicts.length > 0) {
        throw new UsageError(`--force cannot write into ${dir}: these would replace a file with a folder or the reverse: ${conflicts.join(', ')}. Move them first.`);
      }
      try {
        cpSync(stage, target, { recursive: true });
      } catch (error) {
        throw new Error(`Could not finish writing ${dir} (${(error as Error).message}). Some files may already be written there.`);
      }
    } else {
      const existedBefore = existsSync(target);
      const before = new Set(existedBefore ? readdirSync(target) : []);
      try {
        cpSync(stage, target, { recursive: true });
      } catch (error) {
        if (existsSync(target)) {
          for (const entry of readdirSync(target)) {
            if (!before.has(entry)) rmSync(join(target, entry), { recursive: true, force: true });
          }
          if (!existedBefore) rmSync(target, { recursive: true, force: true });
        }
        throw new Error(`Could not write ${dir} (${(error as Error).message}); nothing was left behind.`);
      }
    }
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

  // `run` for every package manager: Yarn 1's built-in `yarn check` shadows the script.
  const run = `${options.pm} run`;
  log('');
  log(`Created ${answers.name} in ${shown}. Next:`);
  log(`  cd ${shown}`);
  if (!options.install) log(`  ${options.pm} install`);
  log(`  ${run} dev     # preview every template`);
  log(`  ${run} check   # your to-do list: each template's description, its own home and screenshot, your products and photos`);
  log('');
  log(`To repeat this setup: ${equivalentCommand(options.pm, dir, answers)}`);
}

/** Flags → answers (prompting when a prompter is given) → the theme. Shared by the CLI and `queek-theme init`. */
export async function runCreate(flags: Flags, prompter: Prompter | null, log?: (line: string) => void): Promise<void> {
  const dir = flags.dir ?? 'my-theme';
  checkTarget(dir, flags.force); // before any question is asked, not just before any write
  const pm = (flags.pm as PackageManager | undefined) ?? detectPackageManager();
  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(pm)) throw new UsageError(`--pm must be npm, pnpm, yarn or bun, not "${pm}".`);
  const answers = await resolveAnswers(flags, prompter);
  await createTheme(dir, answers, { install: flags.install, git: flags.git, pm, dryRun: flags.dryRun, force: flags.force, template: flags.template, log });
}
