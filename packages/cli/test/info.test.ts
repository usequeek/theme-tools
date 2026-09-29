import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectLockfileManager,
  formatInfo,
  knownBrowserPaths,
  satisfiesPeerRange,
  updateCheckStatus,
  type InfoReport,
} from '../src/commands/info.js';

/** The built CLI, run as a user runs it — `pnpm build` first. */
const BIN = resolve(import.meta.dirname, '../bin/run.js');
const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/starter');
const SRC = readFileSync(resolve(import.meta.dirname, '../src/commands/info.ts'), 'utf8');

function runAt(cwd: string, ...args: string[]) {
  const env = { ...process.env, NO_COLOR: '1', QUEEK_SKIP_NEW_VERSION_CHECK: 'true' };
  delete env.QUEEK_THEME_BROWSER;
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env });
}

const minimalReport = (): InfoReport => ({
  tools: { cli: '0.9.2', themeCheck: '0.9.1', createTheme: '0.9.0', node: 'v22.0.0', os: 'linux 1', arch: 'x64' },
  project: {
    root: '/tmp/demo',
    themeDir: '/tmp/demo/theme',
    slug: 'demo',
    name: 'Demo',
    templates: { count: 1, ids: ['shop'] },
    designs: { count: 1, ids: ['default'] },
    packageManager: 'pnpm',
  },
  projectNote: null,
  framework: { next: { version: '16.0.0', wanted: '^16.0.0', supported: true } },
  vocabulary: { source: 'bundled', version: 'v1' },
  port: 7833,
  portDefaultFree: true,
  browser: {
    env: { value: null, exists: null },
    chromium: { path: null, exists: null },
    chrome: [],
    edge: [],
  },
  updateCheck: { off: false, reason: 'on' },
});

describe('queek theme info', () => {
  it('exits 0 outside a theme project, with the tool versions', () => {
    const outside = mkdtempSync(join(tmpdir(), 'queek-info-outside-'));
    const result = runAt(outside, 'theme', 'info');
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Tools');
    expect(result.stdout).toContain('No theme found');
    for (const tool of ['cli', 'theme-check', 'create-theme']) {
      expect(result.stdout, tool).toMatch(new RegExp(`${tool}\\s+\\d+\\.\\d+\\.\\d+`));
    }
  }, 60_000);

  it('--json in fixtures/starter parses, with project.slug, a framework section and a port number', () => {
    const result = runAt(FIXTURE, 'theme', 'info', '--json');
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout) as InfoReport;
    expect(report.project?.slug).toBe('bare');
    expect(report.project?.designs.ids).toContain('default');
    expect(report.framework.next?.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(report.framework['@usequeek/theme-kit']?.wanted).toContain('0.1.8');
    expect(typeof report.port).toBe('number');
    expect(report.tools.cli).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof report.vocabulary.version).toBe('string');
  }, 60_000);

  it('plain output prints every section in order', () => {
    const result = runAt(FIXTURE, 'theme', 'info');
    expect(result.status, result.stderr).toBe(0);
    const headings = ['Tools', 'Project', 'Framework', 'Vocabulary', 'Port', 'Browser', 'Update check'];
    const lines = result.stdout.split('\n');
    const positions = headings.map((heading) => lines.indexOf(heading));
    for (const [i, heading] of headings.entries()) expect(positions[i], heading).toBeGreaterThanOrEqual(0);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(result.stdout).toContain('bare');
  }, 60_000);

  it('never launches a browser: a bogus QUEEK_THEME_BROWSER still exits 0', () => {
    const result = spawnSync(process.execPath, [BIN, 'theme', 'info'], {
      cwd: FIXTURE,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', QUEEK_SKIP_NEW_VERSION_CHECK: 'true', QUEEK_THEME_BROWSER: '/nonexistent/browser-binary' },
    });
    // A launch attempt would fail out; reporting only needs existence.
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('/nonexistent/browser-binary');
  }, 60_000);

  it('the browser section checks existence only — no launch, no spawn', () => {
    expect(SRC).not.toContain('launchBrowser');
    expect(SRC).not.toContain('child_process');
    expect(SRC).not.toContain('spawn');
    expect(SRC).toContain('chromium.executablePath()');
  });
});

describe('queek theme check guides line', () => {
  it('stylish output ends with the Guides line', () => {
    const result = runAt(FIXTURE, 'theme', 'check', '--offline');
    expect(result.stdout.trimEnd().endsWith('Guides: https://docs.usequeek.com/docs/themes/checks'), result.stderr).toBe(true);
  }, 60_000);

  it('--json output never contains the Guides line', () => {
    const jsonFlag = runAt(FIXTURE, 'theme', 'check', '--offline', '--json');
    expect(jsonFlag.stdout).not.toContain('Guides:');
    JSON.parse(jsonFlag.stdout);

    const formatJson = runAt(FIXTURE, 'theme', 'check', '--offline', '--format', 'json');
    expect(formatJson.stdout).not.toContain('Guides:');

    const actions = runAt(FIXTURE, 'theme', 'check', '--offline', '--format', 'github-actions');
    expect(actions.stdout).not.toContain('Guides:');
  }, 60_000);
});

describe('info helpers', () => {
  it('satisfiesPeerRange marks versions inside and outside the CLI peer ranges', () => {
    expect(satisfiesPeerRange('16.3.6', '^16.0.0')).toBe(true);
    expect(satisfiesPeerRange('15.0.0', '^16.0.0')).toBe(false);
    expect(satisfiesPeerRange('19.3.0', '^19.0.0')).toBe(true);
    expect(satisfiesPeerRange('0.1.12', '>=0.1.8')).toBe(true);
    expect(satisfiesPeerRange('0.1.7', '>=0.1.8')).toBe(false);
    expect(satisfiesPeerRange('not-a-version', '^16.0.0')).toBeNull();
  });

  it('detectLockfileManager reads the lockfile present', () => {
    expect(detectLockfileManager(resolve(import.meta.dirname, '../../..'))).toBe('pnpm');
    expect(detectLockfileManager(mkdtempSync(join(tmpdir(), 'queek-info-nolock-')))).toBe('none (no lockfile)');
  });

  it('knownBrowserPaths lists per-OS paths without launching', () => {
    const mac = knownBrowserPaths('darwin', {});
    expect(mac.chrome.map((candidate) => candidate.path)).toEqual([
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ]);
    expect(mac.edge.map((candidate) => candidate.path)).toEqual([
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ]);
    const windows = knownBrowserPaths('win32', { PROGRAMFILES: 'C:\\Program Files' });
    expect(windows.chrome[0]?.path).toContain('chrome.exe');
    expect(windows.edge[0]?.path).toContain('msedge.exe');
    for (const candidate of [...mac.chrome, ...mac.edge]) expect(typeof candidate.exists).toBe('boolean');
  });

  it('updateCheckStatus is off in CI or with QUEEK_NO_UPDATE_CHECK', () => {
    expect(updateCheckStatus({ CI: 'true' }).off).toBe(true);
    expect(updateCheckStatus({ QUEEK_NO_UPDATE_CHECK: '1' }).off).toBe(true);
    expect(updateCheckStatus({}).off).toBe(false);
    expect(updateCheckStatus({ CI: 'false' }).off).toBe(false);
  });

  it('formatInfo says so in one line outside a project', () => {
    const text = formatInfo({ ...minimalReport(), project: null, projectNote: 'No theme found at .: nope.' });
    expect(text).toContain('Project');
    expect(text).toContain('No theme found at .: nope.');
  });
});
