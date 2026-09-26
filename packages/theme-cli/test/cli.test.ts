import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/** The built CLI, run as a user runs it — `pnpm build` first. */
const BIN = resolve(import.meta.dirname, '../bin/run.js');
const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/starter');

const passingDemo = (json: string): string =>
  json.replaceAll('placeholder-', 'sample-').replaceAll('/theme-assets/_bare/', '/theme-assets/test-fixture/');
const passingConfig = (json: string): string =>
  json.replace(/description: 'Replace before publishing\.[^']*'/, "description: 'A plain test store: a banner, a product grid and category tiles. Needs a few product photos.'");

/**
 * A copy of the starter, its placeholders replaced by `mutateDemo` (default:
 * just the photo/slug swap — a theme that should pass clean). Copied inside
 * the repo's fixtures/ (like theme-check's own copy()) rather than the OS
 * tmpdir: theme.config.ts loads through jiti, which resolves
 * @usequeek/theme-kit by walking up from the file's own directory, and a
 * folder outside this workspace has no node_modules chain to find it in.
 */
function stageTheme(mutateDemo: (json: string) => string = passingDemo): string {
  const dir = mkdtempSync(join(resolve(import.meta.dirname, '../../../fixtures'), '.tmp-cli-passing-'));
  cpSync(FIXTURE, dir, { recursive: true });
  const demo = join(dir, 'theme/demo.json');
  writeFileSync(demo, mutateDemo(readFileSync(demo, 'utf8')));
  const config = join(dir, 'theme/theme.config.ts');
  writeFileSync(config, passingConfig(readFileSync(config, 'utf8')));
  return dir;
}

/** A theme with 0 errors but at least one warning: the sales page's closing
 *  contact section is dropped, so theme/template-pages warns ("does not
 *  close on a contact section") without rejecting anything. */
function warningsOnlyTheme(): string {
  return stageTheme((json) => {
    const demo = JSON.parse(passingDemo(json)) as { pages: Record<string, { content?: unknown[] }> };
    demo.pages.sales?.content?.pop();
    return JSON.stringify(demo, null, 2);
  });
}

const PASSING = stageTheme();
const WARNINGS_ONLY = warningsOnlyTheme();
afterAll(() => {
  rmSync(PASSING, { recursive: true, force: true });
  rmSync(WARNINGS_ONLY, { recursive: true, force: true });
});

function runAt(cwd: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', QUEEK_THEME_SKIP_NEW_VERSION_CHECK: 'true' } });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function run(...args: string[]) {
  return runAt(PASSING, ...args);
}

describe('queek-theme check', () => {
  it('exits 0 when there are no errors, and prints what runs at submission', () => {
    const { code, stdout, stderr } = run('check', '--offline');
    expect(code, stderr).toBe(0);
    expect(stdout).toContain('Also checked when you submit');
  }, 60_000);

  it('exits 1 at --fail-level warning when there are only warnings', () => {
    const json = runAt(WARNINGS_ONLY, 'check', '--offline', '--format', 'json');
    const report = JSON.parse(json.stdout);
    expect(report.summary.errors, json.stderr).toBe(0);
    expect(report.summary.warnings, json.stderr).toBeGreaterThanOrEqual(1);

    const plain = runAt(WARNINGS_ONLY, 'check', '--offline');
    expect(plain.code, plain.stderr).toBe(0);

    const { code, stderr } = runAt(WARNINGS_ONLY, 'check', '--offline', '--fail-level', 'warning');
    expect(code, stderr).toBe(1);
  }, 60_000);

  it('exits 2 when it cannot run — no theme there', () => {
    const { code, stderr } = run('check', '--path', 'no-such-folder');
    expect(code, stderr).toBe(2);
    expect(stderr).toContain('no-such-folder does not exist');
  }, 60_000);

  it('--format json is one stable object on stdout', () => {
    const { stdout, stderr } = run('check', '--offline', '--format', 'json');
    expect(stdout, stderr).not.toBe('');
    const report = JSON.parse(stdout);
    expect(Object.keys(report)).toEqual(['theme', 'summary', 'vocabulary', 'findings', 'atSubmission']);
    expect(report.theme).toBe('bare');
    for (const finding of report.findings) expect(Object.keys(finding)).toEqual(['rule', 'level', 'file', 'where', 'message', 'fix', 'docs', 'fixable']);
  }, 60_000);

  it('--format github-actions emits workflow annotations with the file', () => {
    const { stdout, stderr } = runAt(FIXTURE, 'check', '--offline', '--format', 'github-actions');
    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines.length, stderr).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/^::(error|warning) file=theme\/[^,]+,title=theme\/[a-z-]+::/);
  }, 60_000);
});

describe('queek-theme check vocabulary flags', () => {
  const BUNDLED = resolve(import.meta.dirname, '../../theme-check/src/utils/business-vocabulary.json');

  it('parses --offline and --vocabulary', () => {
    const { code, stdout, stderr } = run('check', '--help');
    expect(code, stderr).toBe(0);
    expect(stdout).toContain('--offline');
    expect(stdout).toContain('--vocabulary');
  }, 60_000);

  it('--offline checks the bundled snapshot without the network, and reports it', () => {
    const { code, stdout, stderr } = run('check', '--offline', '--format', 'json');
    expect(code, stderr).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.vocabulary.source).toBe('bundled');
    expect(typeof report.vocabulary.version).toBe('string');
  }, 60_000);

  it('--vocabulary pins a file, and reports source file', () => {
    const { code, stdout, stderr } = run('check', '--vocabulary', BUNDLED, '--format', 'json');
    expect(code, stderr).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.vocabulary.source).toBe('file');
  }, 60_000);

  it('--vocabulary with a missing file exits 2', () => {
    const { code, stderr } = run('check', '--offline', '--vocabulary', 'no-such-vocab.json');
    expect(code).toBe(2);
    expect(stderr).toContain('no-such-vocab.json');
  }, 60_000);
});

describe('queek-theme init', () => {
  it('creates a theme from flags alone', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'init-')), 'my-theme');
    const { code, stderr } = run('init', out, '--yes', '--offline', '--template', FIXTURE, '--templates', 'laundry', '--tags', 'minimal', '--no-install', '--no-git');
    expect(code, stderr).toBe(0);
    expect(existsSync(join(out, 'theme/theme.config.ts'))).toBe(true);
  }, 60_000);

  it('writes my-theme when no folder is given and nothing is asked', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'init-'));
    const { code, stderr } = runAt(cwd, 'init', '--yes', '--offline', '--template', FIXTURE, '--templates', 'laundry', '--tags', 'minimal', '--no-install', '--no-git');
    expect(code, stderr).toBe(0);
    expect(existsSync(join(cwd, 'my-theme/theme/theme.config.ts'))).toBe(true);
  }, 60_000);
});

describe('queek-theme package', () => {
  it('zips the theme folder, and nothing else', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'queek-package-')), 'theme.zip');
    try {
      const { code, stdout, stderr } = run('package', '--offline', '--output', out);
      expect(code, stderr).toBe(0);
      expect(stdout).toContain('Packaged bare');
      expect(existsSync(out)).toBe(true);
    } finally {
      rmSync(out, { force: true });
    }
  }, 60_000);
});

describe('queek-theme', () => {
  it('lists its commands', () => {
    const { code, stdout, stderr } = run('--help');
    expect(code, stderr).toBe(0);
    for (const command of ['check', 'dev', 'init', 'package']) expect(stdout).toContain(command);
  });
});
