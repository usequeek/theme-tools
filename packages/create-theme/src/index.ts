import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { downloadTemplate } from 'giget';
import { parseVocabularyData, resolveVocabulary } from '@usequeek/theme-check';
import { bundledLists, cachedLists, createLists, getActiveLists, setActiveLists, type BusinessLists } from './lists.js';
import { UsageError, equivalentCommand, resolveAnswers, shellWord, type Flags, type PackageManager, type Prompter } from './options.js';
import { setupTheme, type Answers } from './setup.js';

export { UsageError, CancelledError, type Flags, type Prompter, type PackageManager } from './options.js';
export { setupTheme, type Answers } from './setup.js';
export { clackPrompter } from './prompts.js';
export { bundledLists, cachedLists, createLists, getActiveLists, setActiveLists, SHOP_HINT, SHOP_KEY, SHOP_LABEL, type BusinessLists, type BusinessOption, type ListsData } from './lists.js';
/** The rename `npm create` applies to the starter, for tools that copy a theme under a new name (Queek's `yarn theme:new`). */
export { renameTheme, SKELETON, type Identity } from './rename.js';

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

npm needs -- before these flags. In a terminal, anything you leave out is asked,
and with no folder the folder is named after the theme (my-theme with --yes or no terminal).

  --name <text>          theme name (default: the folder name)
  --templates <keys>     businesses to make templates for, comma-separated (required with --yes)
  --primary <key>        the main template (default: the first)
  --categories <keys>    business categories (default: the templates')
  --tags <tags>          1–6 tags for the look (required with --yes)
  --pages <list|none>    extra pages: contact, faq (default: both)
  --ai <list>, --no-ai   AI assistants: claude, gemini (default: both; AGENTS.md unless --no-ai)
  --pm <npm|pnpm|yarn|bun>, --no-install, --no-git
  --yes, -y              never prompt; take the default for everything else
  --dry-run              print what would be written; write nothing
  --force                allow a folder that is not empty
  --template <source>    another starter: a giget source or a local folder
  --vocabulary <file>    a pinned vocabulary file (default: the live copy)
  --offline              use the bundled vocabulary snapshot; no network`;

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
    // Relative to the starter: a starter that itself sits under a node_modules folder still copies.
    cpSync(local, into, { recursive: true, filter: (path) => !/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(relative(local, path)) });
  } else {
    try {
      await downloadTemplate(source, { dir: into, force: true });
    } catch (error) {
      throw new Error(`Could not download the starter from ${source} (${(error as Error).message}). Check your connection, or pass --template github:usequeek/theme-starter for the latest.`);
    }
  }
  if (!existsSync(join(into, 'theme/theme.config.ts'))) throw new UsageError(`${source} is not a Queek theme starter (no theme/theme.config.ts).`);
}

function listFiles(dir: string, root = dir): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path, root) : [relative(root, path).replace(/\\/g, '/')];
  }).sort();
}

/** What the git step does in `target`: nothing (it has .git), skip (no git, or inside a repo), or init. */
function gitStep(target: string): 'present' | 'no-git' | 'inside' | 'init' {
  if (existsSync(join(target, '.git'))) return 'present';
  const inside = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: target, encoding: 'utf8' });
  if (inside.error) return 'no-git';
  return inside.status === 0 ? 'inside' : 'init';
}

export async function createTheme(dir: string, answers: Answers, options: { install: boolean; git: boolean; pm: PackageManager; dryRun: boolean; force: boolean; template?: string; offline?: boolean; vocabularyFile?: string; log?: (line: string) => void }): Promise<void> {
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
      const overwritten = listFiles(stage).filter((file) => lstatOrNull(join(target, file)) !== null);
      if (overwritten.length > 0) log(`Overwriting: ${overwritten.join(', ')}`);
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
  const here = shown === '.';
  const where = here ? 'the current folder' : shown;
  if (options.install) {
    log(`Installing dependencies with ${options.pm}…`);
    const result = spawnSync(options.pm, ['install'], { cwd: target, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) {
      const gitSkipped = options.git && gitStep(target) === 'init';
      throw new Error(`${options.pm} install failed. The theme is in ${where}; run \`${options.pm} install\` there${gitSkipped ? ', then `git init` (skipped because the install failed)' : ''}.`);
    }
  }
  if (options.git) {
    const step = gitStep(target);
    if (step === 'no-git') log('git is not installed; skipped git init.');
    else if (step === 'inside') log('Already inside a git repository; skipped git init.');
    else if (step === 'init' && spawnSync('git', ['init', '-q'], { cwd: target }).status !== 0) log(`git init failed; run it yourself in ${where}.`);
  }

  // `run` for every package manager: Yarn 1's built-in `yarn check` shadows the script.
  const run = `${options.pm} run`;
  log('');
  log(`Created ${answers.name} in ${where}. Next:`);
  if (!here) log(`  cd ${shellWord(shown)}`);
  if (!options.install) log(`  ${options.pm} install`);
  log(`  ${run} dev     # preview every template`);
  log(`  ${run} check   # your to-do list: each template's description, its own home and screenshot, your products and photos`);
  log('');
  log(`To repeat this setup: ${equivalentCommand(options.pm, dir, answers, { template: options.template, install: options.install, git: options.git, offline: options.offline, vocabularyFile: options.vocabularyFile })}`);
}

/** Why `dir` cannot take the theme (`checkTarget`'s message), or null. */
function targetProblem(dir: string, force: boolean): string | null {
  try {
    checkTarget(dir, force);
    return null;
  } catch (error) {
    if (error instanceof UsageError) return error.message;
    throw error;
  }
}

/**
 * The lists the prompts ask from: a pinned file when `--vocabulary` is given
 * (validated — an unreadable or invalid file is a usage error), else the
 * cached copy when one is stored, else the bundled snapshot. Synchronous, so
 * the first question never waits on the network.
 */
function startingLists(flags: Flags): BusinessLists {
  const bundled = bundledLists();
  const withBundledLabels = (data: { services: string[]; catalogue: Record<string, string[]>; subcategories: Record<string, string[]>; root_service?: Record<string, string>; labels?: Record<string, string> }): BusinessLists =>
    createLists({
      services: data.services,
      catalogue: data.catalogue,
      subcategories: data.subcategories,
      root_service: data.root_service,
      // A copy from before labels were stored still gets the bundled names.
      labels: data.labels ?? Object.fromEntries(bundled.businessKeys.map((key) => [key, bundled.labelOf(key)])),
    });
  if (flags.vocabularyFile !== undefined) {
    let raw: string;
    try {
      raw = readFileSync(resolve(flags.vocabularyFile), 'utf8');
    } catch (error) {
      throw new UsageError(`Cannot read --vocabulary ${flags.vocabularyFile} (${(error as Error).message}).`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new UsageError(`--vocabulary ${flags.vocabularyFile} is not valid JSON.`);
    }
    try {
      const data = typeof (parsed as { data?: unknown }).data === 'object' && (parsed as { data?: unknown }).data !== null
        ? parseVocabularyData((parsed as { data: unknown }).data, { requireVersion: false })
        : parseVocabularyData(parsed, { requireVersion: false });
      return withBundledLabels(data);
    } catch (error) {
      throw new UsageError(`--vocabulary ${flags.vocabularyFile} is not a vocabulary (${(error as Error).message}).`);
    }
  }
  if (flags.offline) return bundled;
  return cachedLists() ?? bundled;
}

/**
 * Flags → answers (prompting when a prompter is given) → the theme. Shared by the CLI and `queek-theme init`.
 * With no folder argument, a person at the prompts gets a folder named after the theme's slug (checked
 * with the name, before the next question); a script gets `my-theme`.
 *
 * The prompts ask from the cached-or-bundled copy at once while a live
 * refresh runs in the background; the final `for` is validated against the
 * fresh copy when it has arrived, else the copy the prompts used.
 */
export async function runCreate(flags: Flags, prompter: Prompter | null, log?: (line: string) => void): Promise<void> {
  const named = flags.dir === undefined && prompter !== null;
  if (!named) checkTarget(flags.dir ?? 'my-theme', flags.force); // before any question is asked, not just before any write
  const pm = (flags.pm as PackageManager | undefined) ?? detectPackageManager();
  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(pm)) throw new UsageError(`--pm must be npm, pnpm, yarn or bun, not "${pm}".`);
  const previous = getActiveLists();
  const starting = startingLists(flags);
  setActiveLists(starting);
  // Started at launch, awaited after the answers: the prompts never wait on it.
  const refresh = !flags.offline && flags.vocabularyFile === undefined
    ? resolveVocabulary({ mode: 'live' }).then((resolved) => resolved, () => null)
    : null;
  try {
    const answers = await resolveAnswers(flags, prompter, named ? (slug) => targetProblem(slug, flags.force) : undefined, starting);
    const fresh = refresh ? await refresh : null;
    if (fresh) {
      if (fresh.notice && log) log(fresh.notice);
      const lists = createLists({
        services: fresh.vocabulary.services,
        catalogue: fresh.vocabulary.catalogue,
        subcategories: fresh.vocabulary.subcategories,
        root_service: fresh.vocabulary.root_service,
        labels: fresh.vocabulary.labels ?? Object.fromEntries(starting.businessKeys.map((key) => [key, starting.labelOf(key)])),
      });
      const unknown = answers.templates.map((t) => t.key).filter((key) => !lists.businessKeys.includes(key));
      if (unknown.length > 0) {
        throw new UsageError(`The live vocabulary no longer has ${unknown.map((key) => `"${key}"`).join(', ')} — pick from: ${lists.businessKeys.join(', ')}.`);
      }
      const unknownCategories = answers.categories.filter((key) => !lists.services.includes(key as string));
      if (unknownCategories.length > 0) {
        throw new UsageError(`The live vocabulary no longer has the categor${unknownCategories.length === 1 ? 'y' : 'ies'} ${unknownCategories.map((key) => `"${key}"`).join(', ')}.`);
      }
      setActiveLists(lists);
    }
    const dir = flags.dir ?? (named ? answers.slug : 'my-theme');
    await createTheme(dir, answers, { install: flags.install, git: flags.git, pm, dryRun: flags.dryRun, force: flags.force, template: flags.template, offline: flags.offline, vocabularyFile: flags.vocabularyFile, log });
  } finally {
    setActiveLists(previous);
  }
}
