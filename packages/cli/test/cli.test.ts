import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** The built `queek` bin, run as a user runs it — `pnpm build` first. */
const BIN = resolve(import.meta.dirname, '../bin/run.js');
const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/starter');

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: FIXTURE,
    encoding: 'utf8',
    env: {
      ...process.env,
      NO_COLOR: '1',
      QUEEK_THEME_SKIP_NEW_VERSION_CHECK: 'true',
      QUEEK_SKIP_NEW_VERSION_CHECK: 'true',
    },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

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

  it('theme check --json on a failing theme exits 1 with JSON on stdout and no alias notice', () => {
    const { code, stdout, stderr } = run('theme', 'check', '--json', '--offline', '--path', FIXTURE);
    expect(code, stderr).toBe(1);
    expect(JSON.parse(stdout).theme).toBe('bare');
    expect(stderr).not.toContain('is now `queek theme`');
  }, 60_000);

  it('--version prints @usequeek/cli/0.6.0', () => {
    const { code, stdout, stderr } = run('--version');
    expect(code, stderr).toBe(0);
    expect(stdout).toContain('@usequeek/cli/0.6.0');
  });
});
