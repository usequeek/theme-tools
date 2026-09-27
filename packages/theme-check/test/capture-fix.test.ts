import { describe, expect, it } from 'vitest';
import { structureRule, templateScreenshotRule } from '../src/rules/static.js';
import type { ThemeContext } from '../src/types.js';

/**
 * The screenshot fixes name the `capture` command from the environment, not a
 * hard-coded string — a custom env proves the text comes from the env.
 */
function context(overrides: Partial<ThemeContext> = {}): ThemeContext {
  return {
    env: {
      root: 'theme/',
      docs: 'https://example.test/THEME.md',
      vocabulary: 'the vocabulary',
      scaffold: 'npm create @usequeek/theme',
      preview: (id) => `http://localhost:7833/${id}`,
      capture: (id) => (id === 'default' ? '<primary-cmd>' : `<cmd:${id}>`),
      submission: false,
    },
    slug: 'x',
    dir: '/nowhere/theme',
    retired: false,
    demo: { pages: {} },
    demos: [{ id: 'default', file: 'demo.json', data: { pages: {} } }],
    themeConfig: { default_demo: {}, demos: [{ id: 'food' }] },
    declaredDemos: [{ id: 'food' }],
    defaultDescription: 'A plain test store.',
    defaultFor: ['foods'],
    themeDescription: null,
    manifest: { slug: 'x', variants: {} },
    pageBased: true,
    file: (path) => `/nowhere/theme/${path}`,
    exists: () => false,
    read: () => null,
    ...overrides,
  };
}

describe('screenshot fix texts use the env capture command', () => {
  it('theme/structure names capture(default)', () => {
    const findings = structureRule.run(context());
    const screenshot = findings.find((finding) => finding.rule === 'theme/structure' && finding.found.includes('no theme screenshot'));
    expect(screenshot).toBeDefined();
    expect(screenshot?.fix).toBe('Run `<primary-cmd>` — it captures the homepage at 1280×800 into theme.jpg.');
  });

  it('theme/template-screenshot names capture(id) and the file', () => {
    const findings = templateScreenshotRule.run(context());
    expect(findings).toHaveLength(2);
    const screenshot = findings.find((finding) => finding.where === 'theme/demos/food.jpg');
    expect(screenshot).toBeDefined();
    expect(screenshot?.fix).toBe(
      'Run `<cmd:food>` — it captures this design\'s first screen at 1280×800 into demos/food.jpg. The AI looks at this image before committing to a template — a missing one means a blind pick.',
    );
  });

  it('keeps each rule id, severity and where', () => {
    const structure = structureRule.run(context()).find((finding) => finding.found.includes('no theme screenshot'));
    expect(structure?.rule).toBe('theme/structure');
    expect(structure?.severity).toBe('reject');
    expect(structure?.where).toBe('theme/');

    const template = templateScreenshotRule.run(context()).find((finding) => finding.where === 'theme/demos/food.jpg');
    expect(template?.rule).toBe('theme/template-screenshot');
    expect(template?.severity).toBe('reject');
    expect(template?.where).toBe('theme/demos/food.jpg');
  });
});
