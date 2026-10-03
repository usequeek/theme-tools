import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
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
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', QUEEK_SKIP_NEW_VERSION_CHECK: 'true' } });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function run(...args: string[]) {
  return runAt(PASSING, ...args);
}

describe('queek theme check', () => {
  it('exits 0 when there are no errors, and prints what runs at submission', () => {
    const { code, stdout, stderr } = run('theme', 'check', '--offline');
    expect(code, stderr).toBe(0);
    expect(stdout).toContain('Also checked when you submit');
  }, 60_000);

  it('exits 1 at --fail-level warning when there are only warnings', () => {
    const json = runAt(WARNINGS_ONLY, 'theme', 'check', '--offline', '--format', 'json');
    const report = JSON.parse(json.stdout);
    expect(report.summary.errors, json.stderr).toBe(0);
    expect(report.summary.warnings, json.stderr).toBeGreaterThanOrEqual(1);

    const plain = runAt(WARNINGS_ONLY, 'theme', 'check', '--offline');
    expect(plain.code, plain.stderr).toBe(0);

    const { code, stderr } = runAt(WARNINGS_ONLY, 'theme', 'check', '--offline', '--fail-level', 'warning');
    expect(code, stderr).toBe(1);
  }, 60_000);

  it('exits 2 when it cannot run — no theme there', () => {
    const { code, stderr } = run('theme', 'check', '--path', 'no-such-folder');
    expect(code, stderr).toBe(2);
    expect(stderr).toContain('no-such-folder does not exist');
  }, 60_000);

  it('--format json is one stable object on stdout', () => {
    const { stdout, stderr } = run('theme', 'check', '--offline', '--format', 'json');
    expect(stdout, stderr).not.toBe('');
    const report = JSON.parse(stdout);
    expect(Object.keys(report)).toEqual(['theme', 'summary', 'vocabulary', 'findings', 'atSubmission']);
    expect(report.theme).toBe('bare');
    for (const finding of report.findings) expect(Object.keys(finding)).toEqual(['rule', 'level', 'file', 'where', 'message', 'fix', 'docs', 'fixable']);
  }, 60_000);

  it('--format github-actions emits workflow annotations with the file', () => {
    const { stdout, stderr } = runAt(FIXTURE, 'theme', 'check', '--offline', '--format', 'github-actions');
    const lines = stdout.trim().split('\n').filter(Boolean);
    expect(lines.length, stderr).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(/^::(error|warning) file=theme\/[^,]+,title=theme\/[a-z-]+::/);
  }, 60_000);

  it('prints the whole --format json report before exiting 1 (no pipe truncation past ~8K)', () => {
    const dir = stageTheme((json) => json);
    try {
      for (const template of ['fashion', 'electronics', 'furniture']) {
        const added = runAt(dir, 'theme', 'add', 'template', template, '--yes', '--offline');
        expect(added.code, added.stderr).toBe(0);
      }
      const { code, stdout, stderr } = runAt(dir, 'theme', 'check', '--offline', '--format', 'json');
      expect(code, stderr).toBe(1);
      // Non-vacuous: the old this.exit(1) path cut piped stdout at ~8K, so a
      // small report would pass even with the bug.
      expect(stdout.length).toBeGreaterThan(8192);
      expect(() => JSON.parse(stdout)).not.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 180_000);
});

describe('queek theme check vocabulary flags', () => {
  const BUNDLED = resolve(import.meta.dirname, '../../theme-check/src/utils/business-vocabulary.json');

  it('parses --offline and --vocabulary', () => {
    const { code, stdout, stderr } = run('theme', 'check', '--help');
    expect(code, stderr).toBe(0);
    expect(stdout).toContain('--offline');
    expect(stdout).toContain('--vocabulary');
  }, 60_000);

  it('--offline checks the bundled snapshot without the network, and reports it', () => {
    const { code, stdout, stderr } = run('theme', 'check', '--offline', '--format', 'json');
    expect(code, stderr).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.vocabulary.source).toBe('bundled');
    expect(typeof report.vocabulary.version).toBe('string');
  }, 60_000);

  it('--vocabulary pins a file, and reports source file', () => {
    const { code, stdout, stderr } = run('theme', 'check', '--vocabulary', BUNDLED, '--format', 'json');
    expect(code, stderr).toBe(0);
    const report = JSON.parse(stdout);
    expect(report.vocabulary.source).toBe('file');
  }, 60_000);

  it('--vocabulary with a missing file exits 2', () => {
    const { code, stderr } = run('theme', 'check', '--offline', '--vocabulary', 'no-such-vocab.json');
    expect(code).toBe(2);
    expect(stderr).toContain('no-such-vocab.json');
  }, 60_000);
});

describe('queek theme init', () => {
  it('creates a theme from flags alone', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'init-')), 'my-theme');
    const { code, stderr } = run('theme', 'init', out, '--yes', '--offline', '--template', FIXTURE, '--templates', 'laundry', '--tags', 'minimal', '--no-install', '--no-git');
    expect(code, stderr).toBe(0);
    expect(existsSync(join(out, 'theme/theme.config.ts'))).toBe(true);
  }, 60_000);

  it('writes my-theme when no folder is given and nothing is asked', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'init-'));
    const { code, stderr } = runAt(cwd, 'theme', 'init', '--yes', '--offline', '--template', FIXTURE, '--templates', 'laundry', '--tags', 'minimal', '--no-install', '--no-git');
    expect(code, stderr).toBe(0);
    expect(existsSync(join(cwd, 'my-theme/theme/theme.config.ts'))).toBe(true);
  }, 60_000);
});

describe('queek theme package', () => {
  it('zips the theme folder, and nothing else', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'queek-package-')), 'theme.zip');
    try {
      const { code, stdout, stderr } = run('theme', 'package', '--offline', '--output', out);
      expect(code, stderr).toBe(0);
      expect(stdout).toContain('Packaged bare');
      expect(existsSync(out)).toBe(true);
    } finally {
      rmSync(out, { force: true });
    }
  }, 60_000);

  it('package --json returns the six keys with a correct sha256', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'queek-package-')), 'theme.zip');
    try {
      const { code, stdout, stderr } = run('theme', 'package', '--offline', '--json', '--output', out);
      expect(code, stderr).toBe(0);
      const report = JSON.parse(stdout);
      expect(Object.keys(report).sort()).toEqual(['bytes', 'errors', 'file', 'sha256', 'theme', 'warnings']);
      expect(report.theme).toBe('bare');
      expect(report.file).toBe(relative(PASSING, out));
      const bytes = readFileSync(out);
      expect(report.bytes).toBe(bytes.length);
      expect(report.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(typeof report.errors).toBe('number');
      expect(typeof report.warnings).toBe('number');
    } finally {
      rmSync(out, { force: true });
    }
  }, 60_000);

  it('package --verbose reports the zip entry count on stderr', () => {
    const out = join(mkdtempSync(join(tmpdir(), 'queek-package-')), 'theme.zip');
    try {
      const { code, stderr } = run('theme', 'package', '--offline', '--verbose', '--output', out);
      expect(code, stderr).toBe(0);
      expect(stderr).toContain('[debug] project root:');
      expect(stderr).toContain('[debug] theme dir:');
      expect(stderr).toMatch(/\[debug\] zip entries: \d+/);
    } finally {
      rmSync(out, { force: true });
    }
  }, 60_000);
});

describe('queek theme check --json', () => {
  it('prints the same report as --format json, and exits 1 on errors', () => {
    const withFlag = runAt(FIXTURE, 'theme', 'check', '--offline', '--json');
    const withFormat = runAt(FIXTURE, 'theme', 'check', '--offline', '--format', 'json');
    expect(withFlag.code, withFlag.stderr).toBe(1);
    expect(JSON.parse(withFlag.stdout)).toEqual(JSON.parse(withFormat.stdout));
  }, 60_000);

  it('exits 0 with --json when there are no errors', () => {
    const { code, stdout, stderr } = run('theme', 'check', '--offline', '--json');
    expect(code, stderr).toBe(0);
    expect(JSON.parse(stdout).summary.errors).toBe(0);
  }, 60_000);

  it('--verbose keeps stdout valid JSON and puts debug lines on stderr', () => {
    const { code, stdout, stderr } = run('theme', 'check', '--offline', '--json', '--verbose');
    expect(code, stderr).toBe(0);
    expect(JSON.parse(stdout).theme).toBe('bare');
    expect(stdout).not.toContain('[debug]');
    expect(stderr).toContain('[debug] project root:');
    expect(stderr).toContain('[debug] theme dir:');
    expect(stderr).toContain('[debug] vocabulary: bundled');
    expect(stderr).toContain('[debug] config: no .queek-theme.yml');
    expect(stderr).toMatch(/\[debug\] rule theme\/[a-z-]+: \d+ms/);
  }, 60_000);
});

describe('queek theme check project config', () => {
  /** A fresh copy of the starter project (config written per test, cleaned after). */
  function freshProject(): string {
    const dir = mkdtempSync(join(resolve(import.meta.dirname, '../../../fixtures'), '.tmp-cli-config-'));
    cpSync(FIXTURE, dir, { recursive: true });
    return dir;
  }

  it('check --init writes the file and refuses the second time', () => {
    const dir = freshProject();
    try {
      const first = runAt(dir, 'theme', 'check', '--init');
      expect(first.code, first.stderr).toBe(0);
      const file = join(dir, '.queek-theme.yml');
      expect(existsSync(file)).toBe(true);
      const text = readFileSync(file, 'utf8');
      expect(text).toContain('The config changes warnings only.');
      expect(text).toContain('#  theme/template-business: off');

      const second = runAt(dir, 'theme', 'check', '--init');
      expect(second.code, second.stderr).toBe(2);
      expect(readFileSync(file, 'utf8')).toBe(text);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('check --init --json returns the written file', () => {
    const dir = freshProject();
    try {
      const { code, stdout, stderr } = runAt(dir, 'theme', 'check', '--init', '--json');
      expect(code, stderr).toBe(0);
      expect(JSON.parse(stdout)).toEqual({ file: '.queek-theme.yml' });
      expect(existsSync(join(dir, '.queek-theme.yml'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('exits 2 on an invalid config', () => {
    const dir = freshProject();
    try {
      writeFileSync(join(dir, '.queek-theme.yml'), 'bogus:\n  - 1\n');
      const { code, stderr } = runAt(dir, 'theme', 'check', '--offline');
      expect(code, stderr).toBe(2);
      expect(stderr).toContain('.queek-theme.yml');
      expect(stderr).toContain('bogus');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('applies off and prints the stderr line', () => {
    const dir = warningsOnlyTheme();
    try {
      const before = runAt(dir, 'theme', 'check', '--offline', '--format', 'json');
      expect(JSON.parse(before.stdout).summary.warnings).toBeGreaterThanOrEqual(1);

      writeFileSync(join(dir, '.queek-theme.yml'), 'rules:\n  theme/template-business: off\n  theme/template-pages: off\n  theme/locale-key-unused: off\n  theme/no-hardcoded-strings: off\n');
      const { code, stdout, stderr } = runAt(dir, 'theme', 'check', '--offline', '--format', 'json');
      expect(code, stderr).toBe(0);
      expect(JSON.parse(stdout).summary.warnings).toBe(0);
      expect(stderr).toContain('Using .queek-theme.yml (4 rules changed, 0 ignore patterns).');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

describe('queek', () => {
  it('--help shows the theme topic', () => {
    const { code, stdout, stderr } = run('--help');
    expect(code, stderr).toBe(0);
    expect(stdout).toContain('theme');
  });

  it('theme --help lists the five commands', () => {
    const { code, stdout, stderr } = run('theme', '--help');
    expect(code, stderr).toBe(0);
    for (const command of ['check', 'dev', 'init', 'package', 'screenshot']) expect(stdout).toContain(command);
  });

  it('theme check --help shows $ queek theme check in its examples', () => {
    const { code, stdout, stderr } = run('theme', 'check', '--help');
    expect(code, stderr).toBe(0);
    expect(stdout).toContain('$ queek theme check');
    expect(stdout).not.toContain('theme:check');
  });

  it('theme check --json on a failing theme exits 1 with JSON on stdout', () => {
    const { code, stdout, stderr } = run('theme', 'check', '--json', '--offline', '--path', FIXTURE);
    expect(code, stderr).toBe(1);
    expect(JSON.parse(stdout).theme).toBe('bare');
  }, 60_000);

  it('--version prints @usequeek/cli/<its version>', () => {
    const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as { version: string };
    const { code, stdout, stderr } = run('--version');
    expect(code, stderr).toBe(0);
    expect(stdout).toContain(`@usequeek/cli/${version}`);
  });

  it('never prints queek-theme', () => {
    for (const args of [['--help'], ['theme', '--help']] as string[][]) {
      const { code, stdout, stderr } = run(...args);
      expect(code, stderr).toBe(0);
      expect(stdout, args.join(' ')).not.toContain('queek-theme');
      expect(stderr, args.join(' ')).not.toContain('queek-theme');
    }
  });
});
