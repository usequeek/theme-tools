import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { screenshotTargets } from '../src/commands/screenshot.js';
import type { Project } from '../src/lib/project.js';

/** A theme folder on disk: demo.json plus one alternative design. */
function stageTheme({ pngOnly = false }: { pngOnly?: boolean } = {}): Project {
  const root = mkdtempSync(join(tmpdir(), 'queek-screenshot-'));
  const themeDir = join(root, 'theme');
  cpSync(resolve(import.meta.dirname, '../../../fixtures/starter/theme/demo.json'), join(root, 'demo.json'));
  // Rearrange into the starter layout: <root>/theme/{demo.json,demos/food.json}.
  mkdirSync(themeDir, { recursive: true });
  mkdirSync(join(themeDir, 'demos'), { recursive: true });
  renameSync(join(root, 'demo.json'), join(themeDir, 'demo.json'));
  cpSync(join(themeDir, 'demo.json'), join(themeDir, 'demos', 'food.json'));
  writeFileSync(join(themeDir, pngOnly ? 'theme.png' : 'theme.jpg'), 'fake-image');
  return { root, themeDir };
}

const A = stageTheme();
const PNG_ONLY = stageTheme({ pngOnly: true });
afterAll(() => {
  rmSync(A.root, { recursive: true, force: true });
  rmSync(PNG_ONLY.root, { recursive: true, force: true });
});

describe('screenshotTargets', () => {
  it('maps the primary design to theme.jpg and other designs to demos/<id>.jpg', () => {
    expect(screenshotTargets(A, [])).toEqual([
      { design: 'default', file: 'theme/theme.jpg' },
      { design: 'food', file: 'theme/demos/food.jpg' },
    ]);
  });

  it('maps the primary design to theme.png when only a png exists', () => {
    expect(screenshotTargets(PNG_ONLY, [])).toEqual([
      { design: 'default', file: 'theme/theme.png' },
      { design: 'food', file: 'theme/demos/food.jpg' },
    ]);
  });

  it('limits the run to the requested ids', () => {
    expect(screenshotTargets(A, ['food'])).toEqual([{ design: 'food', file: 'theme/demos/food.jpg' }]);
  });

  it('rejects an unknown id and lists the valid ones', () => {
    const error = (() => {
      try {
        screenshotTargets(A, ['nope']);
      } catch (caught: unknown) {
        return caught;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(Error);
    expect((error as Error & { code?: string }).code).toBe('UNKNOWN_DESIGN');
    expect((error as Error).message).toContain('"nope"');
    expect((error as Error).message).toContain('default');
    expect((error as Error).message).toContain('food');
  });
});

describe('queek-theme screenshot', () => {
  const BIN = resolve(import.meta.dirname, '../bin/run.js');
  const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/starter');

  it('exits 2 and lists the valid designs for an unknown id', () => {
    const result = spawnSync(process.execPath, [BIN, 'screenshot', 'nope'], {
      cwd: FIXTURE,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', QUEEK_THEME_SKIP_NEW_VERSION_CHECK: 'true' },
    });
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('"nope"');
    expect(result.stderr).toContain('default');
  }, 60_000);

  it('documents the capture size and the browser lookup in --help', () => {
    const result = spawnSync(process.execPath, [BIN, 'screenshot', '--help'], {
      cwd: FIXTURE,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', QUEEK_THEME_SKIP_NEW_VERSION_CHECK: 'true' },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('1280×800');
    expect(result.stdout).toContain('QUEEK_THEME_BROWSER');
  }, 60_000);
});
