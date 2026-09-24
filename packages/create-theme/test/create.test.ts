import { spawnSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UsageError, runCreate } from '../src/index.js';
import type { Flags, Prompter } from '../src/options.js';
import { starterProject } from './helpers.js';

/** Every method throws — proves a check ran before any question was asked. */
const throwingPrompter: Prompter = {
  name: () => { throw new Error('should not prompt'); },
  templates: () => { throw new Error('should not prompt'); },
  primary: () => { throw new Error('should not prompt'); },
  categories: () => { throw new Error('should not prompt'); },
  tags: () => { throw new Error('should not prompt'); },
  pages: () => { throw new Error('should not prompt'); },
  ai: () => { throw new Error('should not prompt'); },
};

const BIN = resolve(import.meta.dirname, '../dist/cli.js');
const flags = (dir: string, overrides: Partial<Flags> = {}): Flags => ({
  dir, template: starterProject(), templates: 'laundry,foods', tags: 'minimal',
  install: false, git: false, yes: true, dryRun: false, force: false, ...overrides,
});
const cli = (cwd: string, ...args: string[]) => spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });

describe('runCreate', () => {
  it('creates the theme in the folder', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'create-')), 'my-theme');
    await runCreate(flags(dir), null, () => {});
    expect(existsSync(join(dir, 'theme/demos/foods.json'))).toBe(true);
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
  });

  // Yarn 1 runs its own built-in `yarn check` ("success Folder in sync."), never the script.
  it.each(['npm', 'pnpm', 'yarn', 'bun'])('prints `<pm> run dev` and `<pm> run check` for %s, never the bare form', async (pm) => {
    const dir = join(mkdtempSync(join(tmpdir(), 'create-')), 'my-theme');
    const lines: string[] = [];
    await runCreate(flags(dir, { pm }), null, (line) => lines.push(line));
    const out = lines.join('\n');
    expect(out).toContain(`  ${pm} run dev `);
    expect(out).toContain(`  ${pm} run check `);
    expect(out).not.toMatch(new RegExp(`^\\s*${pm} (dev|check)\\b`, 'm'));
  });

  it('writes nothing with --dry-run', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'create-')), 'my-theme');
    const lines: string[] = [];
    await runCreate(flags(dir, { dryRun: true }), null, (line) => lines.push(line));
    expect(existsSync(dir)).toBe(false);
    expect(lines.join('\n')).toContain('theme/demos/foods.json');
  });

  it('refuses a non-empty folder without --force, and touches nothing in it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'create-'));
    writeFileSync(join(dir, 'notes.txt'), 'mine');
    await expect(runCreate(flags(dir), null, () => {})).rejects.toThrow(/not empty.*--force/);
    expect(readdirSync(dir)).toEqual(['notes.txt']);
  });

  it('accepts a folder holding only .git', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'create-'));
    mkdirSync(join(dir, '.git'));
    await runCreate(flags(dir, { name: 'Git Theme' }), null, () => {});
    expect(existsSync(join(dir, 'theme/theme.config.ts'))).toBe(true);
  });

  it('names the files --force overwrites before writing, and keeps the rest', async () => {
    const starter = starterProject();
    writeFileSync(join(starter, 'README.md'), '# Starter\n');
    const dir = mkdtempSync(join(tmpdir(), 'create-'));
    writeFileSync(join(dir, 'README.md'), '# Mine\n');
    writeFileSync(join(dir, 'notes.txt'), 'mine');
    const lines: string[] = [];
    await runCreate(flags(dir, { template: starter, force: true }), null, (line) => lines.push(line));
    expect(lines).toContain('Overwriting: README.md');
    expect(lines.indexOf('Overwriting: README.md')).toBeLessThan(lines.findIndex((line) => line.startsWith('Created ')));
    expect(readFileSync(join(dir, 'notes.txt'), 'utf8')).toBe('mine');
  });

  it('refuses a target that is a file, even with --force, and leaves it untouched', async () => {
    const parent = mkdtempSync(join(tmpdir(), 'create-'));
    const filePath = join(parent, 'my-theme');
    writeFileSync(filePath, 'do not touch');
    await expect(runCreate(flags(filePath, { force: true }), null, () => {})).rejects.toThrow(/is a file, not a folder/);
    expect(readFileSync(filePath, 'utf8')).toBe('do not touch');
  });

  it('refuses --force when a starter file would replace a folder in the target, and touches nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'create-'));
    mkdirSync(join(dir, 'AGENTS.md')); // the starter ships AGENTS.md as a file
    const before = readdirSync(dir);
    await expect(runCreate(flags(dir, { force: true }), null, () => {})).rejects.toThrow(/cannot write into/);
    expect(readdirSync(dir)).toEqual(before);
  });

  it('checks the target folder before asking anything', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'create-'));
    writeFileSync(join(dir, 'notes.txt'), 'mine');
    await expect(runCreate(flags(dir, { templates: undefined, tags: undefined }), throwingPrompter, () => {})).rejects.toThrow(/not empty.*--force/);
  });

  it('checks --pm before asking anything', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'create-')), 'my-theme');
    await expect(runCreate(flags(dir, { templates: undefined, tags: undefined, pm: 'deno' }), throwingPrompter, () => {})).rejects.toThrow(/--pm must be npm, pnpm, yarn or bun/);
  });

  it('copies a local --template that sits under a node_modules folder', async () => {
    const starter = join(mkdtempSync(join(tmpdir(), 'create-')), 'node_modules', 'starter');
    cpSync(starterProject(), starter, { recursive: true });
    const dir = join(mkdtempSync(join(tmpdir(), 'create-')), 'my-theme');
    await runCreate(flags(dir, { template: starter }), null, () => {});
    expect(existsSync(join(dir, 'theme/theme.config.ts'))).toBe(true);
  });

  it("leaves out a local --template's own node_modules and .git", async () => {
    const starter = starterProject();
    mkdirSync(join(starter, 'node_modules/some-dep'), { recursive: true });
    writeFileSync(join(starter, 'node_modules/some-dep/index.js'), '');
    mkdirSync(join(starter, '.git'));
    writeFileSync(join(starter, '.git/HEAD'), 'ref: refs/heads/main\n');
    const dir = join(mkdtempSync(join(tmpdir(), 'create-')), 'my-theme');
    await runCreate(flags(dir, { template: starter }), null, () => {});
    expect(existsSync(join(dir, 'node_modules'))).toBe(false);
    expect(existsSync(join(dir, '.git'))).toBe(false);
  });

  it('refuses a --template that is not a Queek theme starter (exit 2), leaving no folder', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'create-empty-'));
    const dir = join(mkdtempSync(join(tmpdir(), 'create-')), 'my-theme');
    const error = await runCreate(flags(dir, { template: empty }), null, () => {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UsageError);
    expect((error as Error).message).toBe(`${empty} is not a Queek theme starter (no theme/theme.config.ts).`);
    expect(existsSync(dir)).toBe(false);
  });

  // existsSync follows symlinks, so a dangling one used to read as "nothing here" right
  // up until cpSync tried to write through it and aborted the whole process.
  it.skipIf(process.platform === 'win32')('refuses --force when the target has a symlink where the starter writes a folder, and touches nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'create-'));
    writeFileSync(join(dir, 'notes.txt'), 'mine');
    symlinkSync('/no/such/target/xyz', join(dir, 'docs')); // the starter fixture ships docs/ as a folder
    const before = readdirSync(dir);
    await expect(runCreate(flags(dir, { force: true }), null, () => {})).rejects.toThrow(/cannot write into/);
    expect(readdirSync(dir)).toEqual(before);
  });
});

describe('runCreate with no folder argument', () => {
  const base = (overrides: Partial<Flags> = {}): Flags => ({ template: starterProject(), install: false, git: false, yes: false, dryRun: false, force: false, ...overrides });
  const inFolder = async (cwd: string, run: () => Promise<void>): Promise<void> => {
    const before = process.cwd();
    process.chdir(cwd);
    try { await run(); } finally { process.chdir(before); }
  };
  /** Answers `name` to the name question, and hands over the check the question was given. */
  const answering = (name: string, seeCheck: (problem: (name: string) => string | undefined) => void = () => {}): Prompter => ({
    name: async (_initial, problem) => { seeCheck(problem); return name; },
    templates: async () => ['laundry'],
    primary: async () => 'laundry',
    categories: async (initial) => initial,
    tags: async () => ['minimal'],
    pages: async (initial) => initial,
    ai: async (initial) => initial,
  });

  it('names the folder after the answered name in a terminal', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'create-'));
    await inFolder(cwd, () => runCreate(base(), answering('My Shop'), () => {}));
    expect(existsSync(join(cwd, 'my-shop/theme/theme.config.ts'))).toBe(true);
    expect(existsSync(join(cwd, 'my-theme'))).toBe(false);
  });

  it('the name question refuses a name whose folder cannot be used, with the folder check\'s message', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'create-'));
    mkdirSync(join(cwd, 'busy-shop'));
    writeFileSync(join(cwd, 'busy-shop/notes.txt'), 'mine');
    const checked: Record<string, string | undefined> = {};
    await inFolder(cwd, () => runCreate(base(), answering('Fresh Shop', (problem) => {
      for (const name of ['Busy Shop', 'Fresh Shop']) checked[name] = problem(name);
    }), () => {}));
    expect(checked['Busy Shop']).toBe('busy-shop is not empty. Choose another folder, or pass --force to write into it.');
    expect(checked['Fresh Shop']).toBeUndefined();
    expect(existsSync(join(cwd, 'fresh-shop/theme'))).toBe(true);
    expect(readdirSync(join(cwd, 'busy-shop'))).toEqual(['notes.txt']);
  });

  it('checks the folder of a --name before the next question', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'create-'));
    mkdirSync(join(cwd, 'busy-shop'));
    writeFileSync(join(cwd, 'busy-shop/notes.txt'), 'mine');
    await inFolder(cwd, () => expect(runCreate(base({ name: 'Busy Shop' }), throwingPrompter, () => {})).rejects.toThrow('busy-shop is not empty'));
  });

  it('keeps my-theme without a terminal', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'create-'));
    await inFolder(cwd, () => runCreate(base({ name: 'My Shop', templates: 'laundry', tags: 'minimal', yes: true }), null, () => {}));
    expect(existsSync(join(cwd, 'my-theme/theme/theme.config.ts'))).toBe(true);
  });
});

describe('the closing lines', () => {
  const inFolder = async (cwd: string, run: () => Promise<void>): Promise<void> => {
    const before = process.cwd();
    process.chdir(cwd);
    try { await run(); } finally { process.chdir(before); }
  };

  it("say \"the current folder\" for ., with no cd", async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'create-'));
    const lines: string[] = [];
    await inFolder(cwd, () => runCreate(flags('.', { name: 'Dot Theme' }), null, (line) => lines.push(line)));
    expect(lines).toContain('Created Dot Theme in the current folder. Next:');
    expect(lines.some((line) => /^\s*cd /.test(line))).toBe(false);
  });

  it('quote a cd path with a space', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'create-'));
    const lines: string[] = [];
    await inFolder(cwd, () => runCreate(flags('My Theme'), null, (line) => lines.push(line)));
    expect(lines).toContain("  cd 'My Theme'");
  });

  it('repeat --template, --no-install and --no-git when they were given', async () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'create-')), 'my-theme');
    const template = starterProject();
    const lines: string[] = [];
    await runCreate(flags(dir, { template }), null, (line) => lines.push(line));
    const repeat = lines.find((line) => line.startsWith('To repeat this setup: '));
    expect(repeat).toContain(` --template ${template} --no-install --no-git`);
  });
});

// Fake `git` and package-manager commands on PATH, so their failures can be staged.
describe.skipIf(process.platform === 'win32')('when install or git fails afterwards', () => {
  const withCommands = async (commands: Record<string, string>, run: () => Promise<void>): Promise<void> => {
    const bin = mkdtempSync(join(tmpdir(), 'create-bin-'));
    for (const [name, script] of Object.entries(commands)) {
      writeFileSync(join(bin, name), `#!/bin/sh\n${script}\n`);
      chmodSync(join(bin, name), 0o755);
    }
    const [path, cwd] = [process.env.PATH, process.cwd()];
    process.env.PATH = `${bin}${delimiter}${path}`;
    process.chdir(mkdtempSync(join(tmpdir(), 'create-')));
    try { await run(); } finally { process.env.PATH = path; process.chdir(cwd); }
  };

  it('says so when git init fails', async () => {
    const lines: string[] = [];
    await withCommands({ git: 'case "$1" in rev-parse) exit 128 ;; init) exit 1 ;; esac' }, () =>
      runCreate(flags('my-theme', { git: true }), null, (line) => lines.push(line)));
    expect(lines).toContain('git init failed; run it yourself in my-theme.');
  });

  it('says git init was skipped too when the install fails', async () => {
    await withCommands({ yarn: 'exit 1' }, () =>
      expect(runCreate(flags('my-theme', { pm: 'yarn', install: true, git: true }), null, () => {})).rejects.toThrow(
        'yarn install failed. The theme is in my-theme; run `yarn install` there, then `git init` (skipped because the install failed).',
      ));
  });
});

describe('create-theme, as a command (pnpm build first)', () => {
  it('exits 2 naming the flag when a required answer is missing and there is no terminal', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'create-'));
    const result = cli(cwd, 'my-theme', '--template', starterProject(), '--tags', 'minimal', '--no-install', '--no-git');
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('--templates is required');
  });

  it('exits 1 when the starter cannot be fetched, leaving no folder behind', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'create-'));
    const result = cli(cwd, 'my-theme', '--yes', '--template', 'github:usequeek/no-such-starter-repo', '--templates', 'laundry', '--tags', 'minimal', '--no-install', '--no-git');
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain('--template github:usequeek/theme-starter');
    expect(existsSync(join(cwd, 'my-theme'))).toBe(false);
  });

  it('exits 2 on a mistyped flag, naming the nearest one, with no stack trace', () => {
    const result = cli(mkdtempSync(join(tmpdir(), 'create-')), 'my-theme', '--tag', 'minimal');
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('✖ Unknown flag --tag. Did you mean --tags?');
    expect(result.stderr).not.toMatch(/^\s+at /m);
  });

  it('leaves the suggestion out when no flag is near', () => {
    const result = cli(mkdtempSync(join(tmpdir(), 'create-')), 'my-theme', '--zzzzzzzz');
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('✖ Unknown flag --zzzzzzzz.');
    expect(result.stderr).not.toContain('Did you mean');
  });

  it('exits 2 when a flag is missing its value, with no stack trace', () => {
    const result = cli(mkdtempSync(join(tmpdir(), 'create-')), 'my-theme', '--templates');
    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain('✖ --templates needs a value.');
    expect(result.stderr).not.toMatch(/^\s+at /m);
  });

  it('shows the npm form with -- in --help', () => {
    expect(cli(tmpdir(), '--help').stdout).toContain('npm create @usequeek/theme@latest my-theme -- --templates');
  });

  it('marks --templates and --tags required with --yes in --help, which has no default for them', () => {
    const help = cli(tmpdir(), '--help').stdout;
    expect(help).toMatch(/--templates <keys> .*\(required with --yes\)/);
    expect(help).toMatch(/--tags <tags> .*\(required with --yes\)/);
  });
});
