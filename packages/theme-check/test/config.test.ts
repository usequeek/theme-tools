import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyProjectConfig,
  checkTheme,
  CONFIG_FILE_NAME,
  ConfigError,
  loadProjectConfig,
  renderInitConfig,
  warningRuleIds,
  type Finding,
  type ProjectConfig,
} from '../src/index.js';

const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/starter/theme');

const copies: string[] = [];
afterEach(() => { for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function projectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'project-config-'));
  copies.push(dir);
  return dir;
}

function writeConfig(dir: string, text: string): string {
  const path = join(dir, CONFIG_FILE_NAME);
  writeFileSync(path, text);
  return path;
}

const warn = (rule: string, where = 'theme/a.tsx:1'): Finding =>
  ({ rule, severity: 'warn', theme: 'x', where, found: 'warn found', fix: 'warn fix' });
const reject = (rule: string, where = 'theme/a.tsx:1'): Finding =>
  ({ rule, severity: 'reject', theme: 'x', where, found: 'reject found', fix: 'reject fix' });

const configWith = (rules: ProjectConfig['rules'], ignore: string[] = [], root = '/nowhere'): ProjectConfig =>
  ({ root, path: `${root}/.queek-theme.yml`, rules, ignore });

describe('applyProjectConfig', () => {
  it('off drops a warning', () => {
    expect(applyProjectConfig([warn('theme/template-business')], configWith({ 'theme/template-business': 'off' }))).toEqual([]);
  });

  it('error upgrades a warning to a reject', () => {
    const [upgraded] = applyProjectConfig([warn('theme/template-business')], configWith({ 'theme/template-business': 'error' }));
    expect(upgraded).toMatchObject({ rule: 'theme/template-business', severity: 'reject', found: 'warn found' });
  });

  it('warning is a no-op', () => {
    const findings = [warn('theme/template-business')];
    expect(applyProjectConfig(findings, configWith({}))).toEqual(findings);
  });

  it('off on a rule with a reject finding leaves the reject', () => {
    const findings = [warn('theme/template-business'), reject('theme/template-business')];
    expect(applyProjectConfig(findings, configWith({ 'theme/template-business': 'off' }))).toEqual([findings[1]]);
  });

  it('error never touches a reject finding', () => {
    const findings = [reject('theme/template-business')];
    expect(applyProjectConfig(findings, configWith({ 'theme/template-business': 'error' }))).toEqual(findings);
  });

  it('an ignore glob drops a warning but not a reject', () => {
    const config = configWith({}, ['theme/vendor/**'], '/proj');
    expect(applyProjectConfig([warn('theme/template-pages', 'theme/vendor/a.tsx:3')], config, '/proj')).toEqual([]);
    expect(applyProjectConfig([reject('theme/template-pages', 'theme/vendor/a.tsx:3')], config, '/proj')).toHaveLength(1);
  });

  it('matches the file part of where, past a detail tail', () => {
    const config = configWith({}, ['theme/vendor/**'], '/proj');
    const findings = [warn('theme/template-pages', 'theme/vendor/a.tsx → pages.home')];
    expect(applyProjectConfig(findings, config, '/proj')).toEqual([]);
  });

  it('matches globs from the project root wherever check runs from', () => {
    const config = configWith({}, ['theme/**'], '/proj');
    expect(applyProjectConfig([warn('theme/template-pages', 'theme/demo.json')], config, '/proj')).toEqual([]);
    expect(applyProjectConfig([warn('theme/template-pages', '../proj/theme/demo.json')], config, '/other')).toEqual([]);
  });

  it('a reject in an ignored file stays', () => {
    const config = configWith({}, ['theme/**'], '/proj');
    expect(applyProjectConfig([reject('theme/template-pages', 'theme/demo.json')], config, '/proj')).toHaveLength(1);
  });
});

describe('loadProjectConfig', () => {
  it('is null when there is no file', () => {
    expect(loadProjectConfig(projectDir())).toBeNull();
  });

  it('reads rules and ignore', () => {
    const dir = projectDir();
    writeConfig(dir, 'rules:\n  theme/template-business: off\nignore:\n  - theme/vendor/**\n');
    expect(loadProjectConfig(dir)).toMatchObject({
      rules: { 'theme/template-business': 'off' },
      ignore: ['theme/vendor/**'],
    });
  });

  it('treats warning as the default no-op', () => {
    const dir = projectDir();
    writeConfig(dir, 'rules:\n  theme/template-business: warning\n');
    expect(loadProjectConfig(dir)).toMatchObject({ rules: {} });
  });

  it('reads what check --init writes', () => {
    const dir = projectDir();
    writeConfig(dir, renderInitConfig());
    expect(loadProjectConfig(dir)).toMatchObject({ rules: {}, ignore: [] });
  });

  it.each([
    ['unknown top-level key', 'extra: true\n', 'extra'],
    ['unknown rule id', 'rules:\n  theme/template-busines: off\n', 'theme/template-busines'],
    ['bad value', 'rules:\n  theme/template-business: sometimes\n', 'theme/template-business'],
    ['broken YAML', 'rules: [unclosed\n', '.queek-theme.yml'],
    ['ignore not an array', 'ignore:\n  theme/vendor/**\n', 'ignore'],
    ['ignore not strings', 'ignore:\n  - 42\n', 'ignore'],
  ])('invalid: %s', (_label, text, key) => {
    const dir = projectDir();
    writeConfig(dir, text);
    let error: unknown;
    try {
      loadProjectConfig(dir);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(ConfigError);
    expect((error as Error).message).toContain('.queek-theme.yml');
    expect((error as Error).message).toContain(key);
  });

  it('suggests the closest rule id', () => {
    const dir = projectDir();
    writeConfig(dir, 'rules:\n  theme/template-busines: off\n');
    let message = '';
    try {
      loadProjectConfig(dir);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('theme/template-business');
  });
});

describe('warningRuleIds and renderInitConfig', () => {
  it('lists the rules that can warn, not the reject-only ones', () => {
    expect(warningRuleIds()).toEqual([
      'theme/demo-completeness',
      'theme/template-business',
      'theme/template-pages',
      'theme/locale-key-naming',
      'theme/locale-file-parity',
    ]);
  });

  it('matches every warn-capable rule id in src/rules', () => {
    const dir = resolve(import.meta.dirname, '../src/rules');
    const ids = new Set<string>();
    for (const name of readdirSync(dir).filter((entry) => entry.endsWith('.ts'))) {
      const source = readFileSync(join(dir, name), 'utf8');
      for (const match of source.matchAll(/finding\(context,\s*'([^']+)',\s*([^\n,)]+)/g)) {
        if (match[2]?.includes('warn')) ids.add(match[1] as string);
      }
    }
    expect([...ids].sort()).toEqual([...warningRuleIds()].sort());
    expect(warningRuleIds().length).toBeGreaterThanOrEqual(3);
  });

  it('writes the policy, every warnable rule commented out, and a sample ignore', () => {
    const text = renderInitConfig();
    expect(text).toContain('# The config changes warnings only. Errors are the contract Queek checks when you submit, so nothing turns them off.');
    expect(text).toContain('https://github.com/usequeek/theme-tools/issues');
    for (const id of warningRuleIds()) expect(text).toContain(`#  ${id}: off`);
    expect(text).toContain('#  - theme/vendor/**');
  });
});

describe('checkTheme and the project config', () => {
  it('does not read the config — a developer off stays visible to the submission check', async () => {
    const dir = mkdtempSync(join(resolve(import.meta.dirname, '../../../fixtures'), '.tmp-config-check-'));
    copies.push(dir);
    cpSync(FIXTURE, dir, { recursive: true });
    const demo = join(dir, 'demo.json');
    writeFileSync(demo, readFileSync(demo, 'utf8').replaceAll('placeholder-', 'sample-').replaceAll('/theme-assets/_bare/', '/theme-assets/test-fixture/'));
    writeConfig(dir, 'rules:\n  theme/template-business: off\n');

    const { findings } = await checkTheme(dir, { env: { root: 'theme/' } });
    expect(findings.filter((finding) => finding.rule === 'theme/template-business')).not.toEqual([]);
  }, 60_000);
});
