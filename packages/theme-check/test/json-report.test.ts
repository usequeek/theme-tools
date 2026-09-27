import { describe, expect, it } from 'vitest';
import { formatJson, jsonReport, type CheckResult } from '../src/index.js';

function result(): CheckResult {
  return {
    context: {
      env: { root: 'theme/', docs: 'https://example.test/THEME.md', vocabulary: 'v', scaffold: 's', preview: () => '', submission: false },
      slug: 'x',
      dir: '/nowhere',
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
      file: (path) => path,
      exists: () => false,
      read: () => null,
    },
    findings: [
      { rule: 'theme/a', severity: 'reject', theme: 'x', where: 'theme/a.tsx:1', found: 'f', fix: 'fix', docs: 'd' },
      { rule: 'theme/b', severity: 'warn', theme: 'x', found: 'g', fix: 'fix' },
    ],
    vocabulary: { source: 'bundled', version: 'v1' },
  };
}

describe('jsonReport', () => {
  it('is what formatJson prints — byte-identical', () => {
    const report = result();
    expect(formatJson(report)).toBe(JSON.stringify(jsonReport(report), null, 2));
  });

  it('parses back to the same object', () => {
    const report = result();
    expect(JSON.parse(formatJson(report))).toEqual(jsonReport(report));
  });
});
