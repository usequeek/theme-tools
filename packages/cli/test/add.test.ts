import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/** The built CLI, run as a user runs it — `pnpm build` first. */
const BIN = resolve(import.meta.dirname, '../bin/run.js');
const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/starter');
const MEDLEY_CONFIG = resolve(import.meta.dirname, '../../../fixtures/medley-theme.config.ts');

const staged: string[] = [];
afterAll(() => {
  for (const dir of staged) rmSync(dir, { recursive: true, force: true });
});

/** A copy of the starter, staged inside fixtures/ (like cli.test.ts: theme.config.ts loads through jiti). */
function stageTheme(): string {
  const dir = mkdtempSync(join(resolve(import.meta.dirname, '../../../fixtures'), '.tmp-add-'));
  cpSync(FIXTURE, dir, { recursive: true });
  staged.push(dir);
  return dir;
}

function allFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? allFiles(full) : [`${full}:${statSync(full).size}`];
  }).sort();
}

/** Added vs removed lines (LCS): the config edit must be purely additive. */
function diffLines(before: string, after: string): { removed: string[]; added: string[] } {
  const a = before.split('\n');
  const b = after.split('\n');
  const longest: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      longest[i]![j] = a[i] === b[j] ? longest[i + 1]![j + 1]! + 1 : Math.max(longest[i + 1]![j]!, longest[i]![j + 1]!);
    }
  }
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; } else if (longest[i + 1]![j]! >= longest[i]![j + 1]!) removed.push(a[i++]!);
    else added.push(b[j++]!);
  }
  while (i < a.length) removed.push(a[i++]!);
  while (j < b.length) added.push(b[j++]!);
  return { removed, added };
}

function runAt(cwd: string, ...args: string[]) {
  const result = spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', QUEEK_SKIP_NEW_VERSION_CHECK: 'true' } });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const configOf = (dir: string): string => readFileSync(join(dir, 'theme/theme.config.ts'), 'utf8');

describe('queek theme add template', () => {
  it('adds a template: a store, a declaration, and the next steps', () => {
    const dir = stageTheme();
    const { code, stdout, stderr } = runAt(dir, 'theme', 'add', 'template', 'jewelry', '--yes', '--offline');
    expect(code, stderr).toBe(0);
    expect(stdout).toContain('Added template "jewelry" (design "jewelry", theme/demos/jewelry.json).');
    expect(stdout).toContain('queek theme check');
    expect(stdout).toContain('queek theme screenshot jewelry');
    expect(existsSync(join(dir, 'theme/demos/jewelry.json'))).toBe(true);
    expect(configOf(dir)).toContain("template: 'jewelry'");
  }, 60_000);

  it('keeps the config byte-identical except the added entry', () => {
    const dir = stageTheme();
    const before = configOf(dir);
    const { code, stderr } = runAt(dir, 'theme', 'add', 'template', 'jewelry', '--yes', '--offline');
    expect(code, stderr).toBe(0);
    const { removed, added } = diffLines(before, configOf(dir));
    expect(removed).toEqual([]);
    expect(added.join('\n')).toContain("id: 'jewelry'");
  }, 60_000);

  it('edits the hand-edited medley config the same additive way', () => {
    const dir = stageTheme();
    writeFileSync(join(dir, 'theme/theme.config.ts'), readFileSync(MEDLEY_CONFIG, 'utf8'));
    const before = configOf(dir);
    const { code, stderr } = runAt(dir, 'theme', 'add', 'template', 'jewelry', '--yes', '--offline');
    expect(code, stderr).toBe(0);
    const { removed, added } = diffLines(before, configOf(dir));
    expect(removed).toEqual([]);
    expect(added.join('\n')).toContain("id: 'jewelry'");
    expect(existsSync(join(dir, 'theme/demos/jewelry.json'))).toBe(true);
  }, 60_000);

  it('--json returns { added, files }', () => {
    const dir = stageTheme();
    const { code, stdout, stderr } = runAt(dir, 'theme', 'add', 'template', 'jewelry', '--yes', '--offline', '--json');
    expect(code, stderr).toBe(0);
    const report = JSON.parse(stdout);
    expect(Object.keys(report).sort()).toEqual(['added', 'files']);
    expect(report.added).toMatchObject({ type: 'template', template: 'jewelry', id: 'jewelry' });
    expect(report.files).toEqual(['theme/demos/jewelry.json', 'theme/theme.config.ts']);
  }, 60_000);

  it('--dry-run prints the plan and writes nothing', () => {
    const dir = stageTheme();
    const before = allFiles(dir);
    const { code, stdout, stderr } = runAt(dir, 'theme', 'add', 'template', 'jewelry', '--yes', '--offline', '--dry-run');
    expect(code, stderr).toBe(0);
    expect(stdout).toContain('Would add template "jewelry"');
    expect(allFiles(dir)).toEqual(before);
  }, 60_000);

  it('refuses an unknown business with a suggestion, exit 2', () => {
    const dir = stageTheme();
    const before = allFiles(dir);
    const { code, stderr } = runAt(dir, 'theme', 'add', 'template', 'jewellery', '--yes', '--offline');
    expect(code).toBe(2);
    expect(stderr).toContain('did you mean "jewelry"');
    expect(allFiles(dir)).toEqual(before);
  }, 60_000);

  it('refuses a duplicate template, exit 2', () => {
    const dir = stageTheme();
    expect(runAt(dir, 'theme', 'add', 'template', 'jewelry', '--yes', '--offline').code).toBe(0);
    const { code, stderr } = runAt(dir, 'theme', 'add', 'template', 'jewelry', '--yes', '--offline');
    expect(code).toBe(2);
    expect(stderr).toContain('already exists');
  }, 60_000);
});

describe('queek theme add design', () => {
  function withTemplate(): string {
    const dir = stageTheme();
    const created = runAt(dir, 'theme', 'add', 'template', 'jewelry', '--yes', '--offline');
    expect(created.code, created.stderr).toBe(0);
    return dir;
  }

  it('adds a second design and names the first, printing the next steps', () => {
    const dir = withTemplate();
    const { code, stdout, stderr } = runAt(dir, 'theme', 'add', 'design', 'jewelry', '--label', 'Second look', '--first-label', 'Main', '--yes', '--offline');
    expect(code, stderr).toBe(0);
    expect(stdout).toContain('Added design "jewelry-2" to template "jewelry"');
    expect(stdout).toContain('queek theme screenshot jewelry-2');
    expect(existsSync(join(dir, 'theme/demos/jewelry-2.json'))).toBe(true);
    expect(configOf(dir)).toContain("design_label: 'Main'");
  }, 60_000);

  it('suggests -3 once -2 exists, then refuses a 4th design', () => {
    const dir = withTemplate();
    const second = runAt(dir, 'theme', 'add', 'design', 'jewelry', '--label', 'Second look', '--first-label', 'Main', '--yes', '--offline', '--json');
    expect(second.code, second.stderr).toBe(0);
    expect(JSON.parse(second.stdout).added).toMatchObject({ id: 'jewelry-2' });
    const third = runAt(dir, 'theme', 'add', 'design', 'jewelry', '--label', 'Third look', '--yes', '--offline', '--json');
    expect(third.code, third.stderr).toBe(0);
    expect(JSON.parse(third.stdout).added).toMatchObject({ id: 'jewelry-3' });
    const fourth = runAt(dir, 'theme', 'add', 'design', 'jewelry', '--label', 'Fourth look', '--yes', '--offline');
    expect(fourth.code).toBe(2);
    expect(fourth.stderr).toContain('at most 3');
    expect(existsSync(join(dir, 'theme/demos/jewelry-4.json'))).toBe(false);
  }, 120_000);

  it('requires --first-label when design 1 has none, exit 2', () => {
    const dir = withTemplate();
    const { code, stderr } = runAt(dir, 'theme', 'add', 'design', 'jewelry', '--label', 'Second look', '--yes', '--offline');
    expect(code).toBe(2);
    expect(stderr).toContain('--first-label');
  }, 60_000);

  it('refuses an unknown template, exit 2', () => {
    const dir = stageTheme();
    const { code, stderr } = runAt(dir, 'theme', 'add', 'design', 'no-such-template', '--label', 'X', '--yes', '--offline');
    expect(code).toBe(2);
    expect(stderr).toContain('Unknown template');
  }, 60_000);
});

describe('queek theme add page', () => {
  it('adds a missing page from the skeleton and says what is next', () => {
    const dir = stageTheme();
    const demo = join(dir, 'theme/demo.json');
    const store = JSON.parse(readFileSync(demo, 'utf8')) as { pages: Record<string, unknown> };
    delete store.pages.faq;
    writeFileSync(demo, `${JSON.stringify(store, null, 2)}\n`);

    const { code, stdout, stderr } = runAt(dir, 'theme', 'add', 'page', 'faq', '--offline');
    expect(code, stderr).toBe(0);
    expect(stdout).toContain('Added the faq page to design "default"');
    expect(stdout).toContain('queek theme check');
    expect(Object.keys(JSON.parse(readFileSync(demo, 'utf8')).pages)).toContain('faq');
  }, 60_000);

  it('refuses a duplicate page and an unknown template, exit 2', () => {
    const dir = stageTheme();
    const duplicate = runAt(dir, 'theme', 'add', 'page', 'contact', '--offline');
    expect(duplicate.code).toBe(2);
    expect(duplicate.stderr).toContain('already has a contact page');
    const unknown = runAt(dir, 'theme', 'add', 'page', 'contact', '--template', 'no-such-template', '--offline');
    expect(unknown.code).toBe(2);
    expect(unknown.stderr).toContain('Unknown template');
  }, 60_000);

  it('refuses an unknown page, exit 2', () => {
    const dir = stageTheme();
    const { code } = runAt(dir, 'theme', 'add', 'page', 'blog', '--offline');
    expect(code).toBe(2);
  }, 60_000);
});

describe('queek theme add then check', () => {
  it('lists the new designs\u2019 expected to-do and no structural error', () => {
    const dir = stageTheme();
    expect(runAt(dir, 'theme', 'add', 'template', 'jewelry', '--yes', '--offline').code).toBe(0);
    const design = runAt(dir, 'theme', 'add', 'design', 'jewelry', '--label', 'Second look', '--first-label', 'Main', '--yes', '--offline');
    expect(design.code, design.stderr).toBe(0);

    const { stdout, stderr } = runAt(dir, 'theme', 'check', '--offline', '--json');
    const report = JSON.parse(stdout) as {
      findings: Array<{ rule: string; level: string; where: string; found: string }>;
    };
    const errors = report.findings.filter((finding) => finding.level === 'error');
    const rules = new Set(errors.map((finding) => finding.rule));
    for (const structural of ['theme/template-designs', 'theme/template-business', 'theme/demo-stores']) {
      expect([...rules], stderr).not.toContain(structural);
    }
    for (const todo of ['theme/template-description', 'theme/template-screenshot', 'theme/placeholder-content']) {
      expect([...rules], stderr).toContain(todo);
    }
    const text = JSON.stringify(errors);
    expect(text).toContain('jewelry');
  }, 180_000);
});

describe('queek theme add help', () => {
  it('theme --help lists the add topic, and add lists its three commands', () => {
    const dir = stageTheme();
    const top = runAt(dir, 'theme', '--help');
    expect(top.code, top.stderr).toBe(0);
    expect(top.stdout).toContain('theme add');
    const add = runAt(dir, 'theme', 'add', '--help');
    expect(add.code, add.stderr).toBe(0);
    for (const command of ['theme add design', 'theme add page', 'theme add template']) expect(add.stdout).toContain(command);
  }, 60_000);
});
