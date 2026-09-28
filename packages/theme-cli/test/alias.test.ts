import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `queek-theme` stays as an alias: one notice line on stderr, stdout
 * unchanged. The umbrella bin (`queek theme`) never prints it.
 */
const ALIAS_BIN = resolve(import.meta.dirname, '../bin/run.js');
const UMBRELLA_BIN = resolve(import.meta.dirname, '../../cli/bin/run.js');
const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/starter');

const NOTICE = '`queek-theme` is now `queek theme` — npm install -D @usequeek/cli';

function run(bin: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [bin, ...args], {
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

describe('queek-theme alias bin', () => {
  it('prints the alias notice on stderr, and stdout still parses as JSON', () => {
    const { code, stdout, stderr } = run(ALIAS_BIN, 'check', '--json', '--offline');
    expect(code, stderr).toBe(1);
    expect(stderr).toContain(NOTICE);
    expect(JSON.parse(stdout).theme).toBe('bare');
  }, 60_000);

  it('matches the umbrella bin on stdout and exit code', () => {
    const alias = run(ALIAS_BIN, 'check', '--json', '--offline');
    const umbrella = run(UMBRELLA_BIN, 'theme', 'check', '--json', '--offline');
    expect(umbrella.code, umbrella.stderr).toBe(alias.code);
    expect(JSON.parse(umbrella.stdout)).toEqual(JSON.parse(alias.stdout));
    expect(umbrella.stderr).not.toContain(NOTICE);
  }, 120_000);
});
