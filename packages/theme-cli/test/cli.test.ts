import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The built CLI, run as a user runs it — `pnpm build` first. */
const BIN = resolve(import.meta.dirname, '../bin/run.js');
const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/starter');

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd: FIXTURE, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', QUEEK_THEME_SKIP_NEW_VERSION_CHECK: 'true' } });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('queek-theme check', () => {
  it('exits 0 when there are no errors, and prints what runs at submission', () => {
    const { code, stdout, stderr } = run('check');
    expect(code, stderr).toBe(0);
    expect(stdout).toContain('Also checked when you submit');
  }, 60_000);

  it('exits 1 at --fail-level warning when there are warnings', () => {
    const { code, stderr } = run('check', '--fail-level', 'warning');
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
    const { stdout, stderr } = run('check', '--format', 'github-actions');
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
