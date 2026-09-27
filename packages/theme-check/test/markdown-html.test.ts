import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { markdownHtmlRule } from '../src/rules/static.js';
import { RULES } from '../src/run.js';
import type { ThemeContext } from '../src/types.js';

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

function themeDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'markdown-html-'));
  for (const [name, source] of Object.entries(files)) writeFileSync(join(dir, name), source);
  return dir;
}

const FOUND = 'renderMarkdown(…) passed to dangerouslySetInnerHTML — it returns elements, so the page shows "[object Object]"';
const FIX = 'Render the elements as children: `<div className="…">{renderMarkdown(text, basePath)}</div>`, or use `<Markdown>` from @usequeek/theme-kit/components/markdown.';

describe('theme/markdown-html', () => {
  it('is registered as a reject rule', () => {
    expect(RULES.map((rule) => rule.id)).toContain('theme/markdown-html');
    expect(markdownHtmlRule.kind).toBe('static');
  });

  it('flags the direct form on one line, naming the __html line', async () => {
    const dir = themeDir({
      'a.tsx': 'import { renderMarkdown } from "@usequeek/theme-kit/utils/markdown";\nexport const A = () => <div dangerouslySetInnerHTML={{ __html: renderMarkdown(text, base) }} />;\n',
    });
    const found = await markdownHtmlRule.run(context(dir));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rule: 'theme/markdown-html', severity: 'reject', where: 'a.tsx:2', found: FOUND, fix: FIX });
    expect(found[0]?.docs).toBe('https://example.test/THEME.md#what-themes-must-not-do');
  });

  it('flags the direct form across newlines', async () => {
    const dir = themeDir({
      'a.tsx': [
        'import { renderMarkdown } from "@usequeek/theme-kit/utils/markdown";',
        'export const A = () => (',
        '  <div dangerouslySetInnerHTML={{',
        '    __html: renderMarkdown(text, base),',
        '  }} />',
        ');',
        '',
      ].join('\n'),
    });
    const found = await markdownHtmlRule.run(context(dir));
    expect(found).toHaveLength(1);
    expect(found[0]?.where).toBe('a.tsx:4');
  });

  it.each(['const', 'let', 'var'])('flags the call assigned with %s, then used as __html', async (keyword) => {
    const dir = themeDir({
      'a.tsx': [
        'import { renderMarkdown } from "@usequeek/theme-kit/utils/markdown";',
        `export const A = ({ text }) => { ${keyword} html = renderMarkdown(text, base); return <div dangerouslySetInnerHTML={{ __html: html }} />; };`,
        '',
      ].join('\n'),
    });
    const found = await markdownHtmlRule.run(context(dir));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ rule: 'theme/markdown-html', severity: 'reject', where: 'a.tsx:2', found: FOUND });
  });

  it('leaves rendering as children alone', async () => {
    const dir = themeDir({
      'a.tsx': 'import { renderMarkdown } from "@usequeek/theme-kit/utils/markdown";\nexport const A = ({ text }) => <div className="copy">{renderMarkdown(text, basePath)}</div>;\n',
    });
    expect(await markdownHtmlRule.run(context(dir))).toEqual([]);
  });

  it('only reads .ts/.tsx files', async () => {
    const dir = themeDir({
      'a.js': 'export const A = () => <div dangerouslySetInnerHTML={{ __html: renderMarkdown(text, base) }} />;\n',
    });
    expect(await markdownHtmlRule.run(context(dir))).toEqual([]);
  });
});
