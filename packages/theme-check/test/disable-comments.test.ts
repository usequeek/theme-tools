import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyDisableComments } from '../src/index.js';
import { disableCommentRule } from '../src/rules/static.js';
import type { Finding, ThemeContext } from '../src/types.js';

function themeDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'disable-comments-'));
  for (const [name, source] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, source);
  }
  return dir;
}

const warn = (rule: string, where: string): Finding =>
  ({ rule, severity: 'warn', theme: 'x', where, found: 'warn found', fix: 'warn fix' });
const reject = (rule: string, where: string): Finding =>
  ({ rule, severity: 'reject', theme: 'x', where, found: 'reject found', fix: 'reject fix' });

function context(dir: string): ThemeContext {
  return {
    env: { root: 'theme/', docs: 'https://example.test/THEME.md', vocabulary: 'the vocabulary', scaffold: 'npm create @usequeek/theme', preview: (id) => `http://localhost:3000/${id}`, submission: false },
    slug: 'x',
    dir,
    retired: false,
    demo: null,
    demos: [],
    themeConfig: null,
    declaredDemos: [],
    defaultDescription: null,
    defaultFor: null,
    themeDescription: null,
    manifest: null,
    pageBased: false,
    file: (path) => join(dir, path),
    exists: () => false,
    read: () => null,
  };
}

describe('applyDisableComments', () => {
  it('drops the warning on the next line only', () => {
    const dir = themeDir({
      'card.tsx': '// queek-theme-disable-next-line theme/template-business\nconst a = 1;\nconst b = 2;\n',
    });
    const findings = [
      warn('theme/template-business', 'theme/card.tsx:2'),
      warn('theme/template-business', 'theme/card.tsx:3'),
    ];
    expect(applyDisableComments(findings, dir)).toEqual([findings[1]]);
  });

  it('leaves a reject on the next line alone', () => {
    const dir = themeDir({
      'card.tsx': '// queek-theme-disable-next-line theme/template-business\nconst a = 1;\n',
    });
    const findings = [reject('theme/template-business', 'theme/card.tsx:2')];
    expect(applyDisableComments(findings, dir)).toEqual(findings);
  });

  it('leaves other rules alone', () => {
    const dir = themeDir({
      'card.tsx': '// queek-theme-disable-next-line theme/template-business\nconst a = 1;\n',
    });
    const findings = [warn('theme/template-pages', 'theme/card.tsx:2')];
    expect(applyDisableComments(findings, dir)).toEqual(findings);
  });

  it('reads several ids from one comment', () => {
    const dir = themeDir({
      'card.tsx': '// queek-theme-disable-next-line theme/template-business, theme/template-pages\nconst a = 1;\n',
    });
    const findings = [
      warn('theme/template-business', 'theme/card.tsx:2'),
      warn('theme/template-pages', 'theme/card.tsx:2'),
    ];
    expect(applyDisableComments(findings, dir)).toEqual([]);
  });

  it('supports the CSS form', () => {
    const dir = themeDir({
      'theme.css': '/* queek-theme-disable-next-line theme/template-pages */\n.a { color: red; }\n',
    });
    expect(applyDisableComments([warn('theme/template-pages', 'theme/theme.css:2')], dir)).toEqual([]);
  });

  it('adds a theme/disable-comment warning for an unknown id, naming the closest', () => {
    const dir = themeDir({
      'card.tsx': '// queek-theme-disable-next-line theme/template-busines\nconst a = 1;\n',
    });
    const found = applyDisableComments([warn('theme/template-pages', 'theme/other.tsx:9')], dir);
    const added = found.filter((finding) => finding.rule === 'theme/disable-comment');
    expect(added).toHaveLength(1);
    expect(added[0]?.severity).toBe('warn');
    expect(added[0]?.where).toContain('card.tsx:1');
    expect(added[0]?.found).toBe('unknown rule "theme/template-busines" in a disable comment');
    expect(added[0]?.fix).toContain('theme/template-business');
    // The unrelated warning passes through untouched.
    expect(found).toHaveLength(2);
  });

  it('does not duplicate a disable-comment finding that is already there', () => {
    const dir = themeDir({
      'card.tsx': '// queek-theme-disable-next-line theme/template-busines\nconst a = 1;\n',
    });
    const once = applyDisableComments([], dir);
    expect(once.filter((finding) => finding.rule === 'theme/disable-comment')).toHaveLength(1);
    const twice = applyDisableComments(once, dir);
    expect(twice.filter((finding) => finding.rule === 'theme/disable-comment')).toHaveLength(1);
  });

  it('is quiet when there is nothing to do', () => {
    const dir = themeDir({ 'card.tsx': 'const a = 1;\n' });
    const findings = [warn('theme/template-business', 'theme/card.tsx:1')];
    expect(applyDisableComments(findings, dir)).toEqual(findings);
  });
});

describe('theme/disable-comment', () => {
  it('warns on an unknown id in a source file', async () => {
    const dir = themeDir({
      'card.tsx': '// queek-theme-disable-next-line theme/nope\nconst a = 1;\n',
    });
    const found = await disableCommentRule.run(context(dir));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      rule: 'theme/disable-comment',
      severity: 'warn',
      where: 'theme/card.tsx:1',
      found: 'unknown rule "theme/nope" in a disable comment',
    });
  });

  it('stays quiet for known ids', async () => {
    const dir = themeDir({
      'card.tsx': '// queek-theme-disable-next-line theme/template-business\nconst a = 1;\n',
    });
    expect(await disableCommentRule.run(context(dir))).toEqual([]);
  });
});
