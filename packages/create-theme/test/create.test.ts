import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runCreate } from '../src/index.js';
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

  it('shows the npm form with -- in --help', () => {
    expect(cli(tmpdir(), '--help').stdout).toContain('npm create @usequeek/theme@latest my-theme -- --templates');
  });
});
