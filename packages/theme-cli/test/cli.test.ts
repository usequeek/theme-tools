import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/** The built CLI, run as a user runs it — `pnpm build` first. */
const BIN = resolve(import.meta.dirname, '../bin/run.js');
const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/starter');

/**
 * The starter with its placeholders replaced — a theme that should pass.
 * Copied inside the repo's fixtures/ (like theme-check's own copy()) rather
 * than the OS tmpdir: theme.config.ts loads through jiti, which resolves
 * @usequeek/theme-kit by walking up from the file's own directory, and a
 * folder outside this workspace has no node_modules chain to find it in.
 */
function passingTheme(): string {
  const dir = mkdtempSync(join(resolve(import.meta.dirname, '../../../fixtures'), '.tmp-cli-passing-'));
  cpSync(FIXTURE, dir, { recursive: true });
  const demo = join(dir, 'theme/demo.json');
  writeFileSync(demo, readFileSync(demo, 'utf8').replaceAll('placeholder-', 'sample-').replaceAll('/theme-assets/_bare/', '/theme-assets/test-fixture/'));
  const config = join(dir, 'theme/theme.config.ts');
  writeFileSync(config, readFileSync(config, 'utf8').replace(/description: 'Replace before publishing\.[^']*'/, "description: 'A plain test store: a banner, a product grid and category tiles. Needs a few product photos.'"));
  return dir;
}

const PASSING = passingTheme();
afterAll(() => rmSync(PASSING, { recursive: true, force: true }));

function runAt(cwd: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', QUEEK_THEME_SKIP_NEW_VERSION_CHECK: 'true' } });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function run(...args: string[]) {
  return runAt(PASSING, ...args);
}

describe('queek-theme check', () => {
  it('exits 0 when there are no errors, and prints what runs at submission', () => {
    const { code, stdout, stderr } = run('check');
    expect(code, stderr).toBe(0);
    expect(stdout).toContain('Also checked when you submit');
  }, 60_000);

  it('exits 1 at --fail-level warning when there are findings', () => {
    // The unmodified skeleton carries the starter's placeholders by design
    // (theme/placeholder-content, theme/template-description) — a fixture
    // guaranteed to have at least one finding, unlike the passing copy above.
    const { code, stderr } = runAt(FIXTURE, 'check', '--fail-level', 'warning');
    expect(code, stderr).toBe(1);
  }, 60_000);

  it('exits 2 when it cannot run — no theme there', () => {
    const { code, stderr } = run('check', '--path', 'no-such-folder');
    expect(code, stderr).toBe(2);
    expect(stderr).toContain('no-such-folder does not exist');
  }, 60_000);

  it('--format json is one stable object on stdout', () => {
    const { stdout, stderr } = run('check', '--format', 'json');
    expect(stdout, stderr).not.toBe('');
    const report = JSON.parse(stdout);
    expect(Object.keys(report)).toEqual(['theme', 'summary', 'findings', 'atSubmission']);
    expect(report.theme).toBe('bare');
    for (const finding of report.findings) expect(Object.keys(finding)).toEqual(['rule', 'level', 'file', 'where', 'message', 'fix', 'docs', 'fixable']);
  }, 60_000);

  it('--format github-actions emits workflow annotations with the file', () => {
    const { stdout, stderr } = runAt(FIXTURE, 'check', '--format', 'github-actions');
    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines.length, stderr).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/^::(error|warning) file=theme\/[^,]+,title=theme\/[a-z-]+::/);
  }, 60_000);
});

describe('queek-theme init', () => {
  it('creates a theme from flags alone', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'init-')), 'my-theme');
    const { code, stderr } = run('init', out, '--yes', '--template', FIXTURE, '--templates', 'laundry', '--tags', 'minimal', '--no-install', '--no-git');
    expect(code, stderr).toBe(0);
    expect(existsSync(join(out, 'theme/theme.config.ts'))).toBe(true);
  }, 60_000);
});

describe('queek-theme package', () => {
  it('zips the theme folder, and nothing else', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'queek-package-')), 'theme.zip');
    try {
      const { code, stdout, stderr } = run('package', '--output', out);
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
