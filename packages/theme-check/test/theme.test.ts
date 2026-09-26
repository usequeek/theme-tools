import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bundledVersion, checkTheme, rejects } from '../src/index.js';

const FIXTURE = resolve(import.meta.dirname, '../../../fixtures/starter/theme');

/** A throwaway copy of the fixture theme, inside the repo so its imports resolve. */
const copies: string[] = [];
function copy(): string {
  const dir = mkdtempSync(join(resolve(import.meta.dirname, '../../../fixtures'), '.tmp-'));
  cpSync(FIXTURE, dir, { recursive: true });
  copies.push(dir);
  return dir;
}
afterEach(() => { for (const dir of copies.splice(0)) rmSync(dir, { recursive: true, force: true }); });

/** The skeleton with its placeholders replaced — the starter carries them by
 *  design (theme/placeholder-content, theme/template-description), so a
 *  finished-theme assertion needs its own copy with those swapped out. */
function passingCopy(): string {
  const dir = copy();
  const demo = join(dir, 'demo.json');
  writeFileSync(demo, readFileSync(demo, 'utf8').replaceAll('placeholder-', 'sample-').replaceAll('/theme-assets/_bare/', '/theme-assets/test-fixture/'));
  const config = join(dir, 'theme.config.ts');
  writeFileSync(config, readFileSync(config, 'utf8').replace(/description: 'Replace before publishing\.[^']*'/, "description: 'A plain test store: a banner, a product grid and category tiles. Needs a few product photos.'"));
  return dir;
}

describe('checkTheme on a real theme folder', () => {
  it('passes the skeleton, naming files relative to where it runs', async () => {
    const { context, findings } = await checkTheme(passingCopy(), { env: { root: 'theme/' } });
    expect(context.slug).toBe('bare');
    expect(rejects(findings)).toEqual([]);
    expect(findings.every((f) => !f.where || f.where.startsWith('theme/'))).toBe(true);
  }, 60_000);

  it('runs on the bundled vocabulary by default, and reports its source and version', async () => {
    const { vocabulary } = await checkTheme(passingCopy(), { env: { root: 'theme/' } });
    expect(vocabulary.source).toBe('bundled');
    expect(vocabulary.version).toBe(bundledVersion());
  }, 60_000);

  it('checks `for` against a passed vocabulary instead of the bundled one', async () => {
    const dir = passingCopy();
    const vocabulary = { data: { services: ['laundry'], catalogue: {}, subcategories: {} }, source: 'file' as const };
    const { findings, vocabulary: reported } = await checkTheme(dir, { env: { root: 'theme/' }, vocabulary });
    expect(rejects(findings).map((f) => f.rule)).toContain('theme/template-business');
    expect(reported).toEqual({ source: 'file', version: 'unknown' });
  }, 60_000);

  it('advises (warn, never reject) on the skeleton’s shop-only template', async () => {
    const { findings } = await checkTheme(passingCopy(), { env: { root: 'theme/' } });
    const advisory = findings.filter((finding) => finding.rule === 'theme/template-business');
    expect(advisory).toHaveLength(1);
    expect(advisory[0].severity).toBe('warn');
    expect(advisory[0].found).toBe('template "default" is for only "shop"');
    expect(rejects(findings)).toEqual([]);
  }, 60_000);

  it("rejects the unmodified skeleton for the placeholders it ships by design", async () => {
    const { findings } = await checkTheme(FIXTURE, { env: { root: 'theme/' } });
    expect(rejects(findings).map((f) => f.rule).sort()).toEqual(['theme/placeholder-content', 'theme/template-description']);
  }, 60_000);

  it("rejects a theme description that is still create's placeholder", async () => {
    const dir = passingCopy();
    const config = join(dir, 'theme.config.ts');
    writeFileSync(config, readFileSync(config, 'utf8').replace(/description: 'The starting skeleton[^']*'/, "description: 'Replace before publishing. What this theme is, in one sentence.'"));
    const { findings } = await checkTheme(dir, { env: { root: 'theme/' } });
    expect(rejects(findings).map((f) => [f.rule, f.where])).toEqual([['theme/placeholder-content', 'theme/theme.config.ts → description']]);
  }, 60_000);

  it('reads the template each design declares in theme.config.ts (theme/template-designs)', async () => {
    const dir = passingCopy();
    const config = join(dir, 'theme.config.ts');
    const source = readFileSync(config, 'utf8');
    // A Windows checkout has CRLF line endings.
    const line = /^ {4}template: 'shop',\r?\n/m;
    expect(source).toMatch(line);
    writeFileSync(config, source.replace(line, ''));
    const { findings } = await checkTheme(dir, { env: { root: 'theme/' } });
    expect(rejects(findings).map((f) => [f.rule, f.found])).toEqual([['theme/template-designs', 'the main template has no key (default_demo.template)']]);
  }, 60_000);

  it('catches a demo store whose products belong to another shop', async () => {
    const dir = copy();
    const demo = JSON.parse(readFileSync(join(dir, 'demo.json'), 'utf8'));
    demo.products[0].shop_id = 'someone-else';
    writeFileSync(join(dir, 'demo.json'), JSON.stringify(demo));
    const { findings } = await checkTheme(dir);
    expect(rejects(findings).map((f) => f.rule)).toContain('theme/demo-store');
  }, 60_000);

  it('catches a manifest field the component never reads (field parity, via the TypeScript compiler)', async () => {
    const dir = copy();
    const manifest = readFileSync(join(dir, 'manifest.ts'), 'utf8');
    writeFileSync(join(dir, 'manifest.ts'), manifest.replace("fields: { title: { type: 'string' }, limit: { type: 'int' } },", "fields: { title: { type: 'string' }, limit: { type: 'int' }, never_read: { type: 'string' } },"));
    const { findings } = await checkTheme(dir);
    expect(rejects(findings).map((f) => f.rule)).toContain('theme/field-parity');
  }, 60_000);

  it('does not ask a developer to host images or upload screenshots — Queek does that on submission', async () => {
    const dir = copy();
    const demo = JSON.parse(readFileSync(join(dir, 'demo.json'), 'utf8'));
    demo.products[0].media.image = 'https://images.example.com/a.jpg';
    writeFileSync(join(dir, 'demo.json'), JSON.stringify(demo));
    const local = await checkTheme(dir);
    expect(local.findings.map((f) => f.rule)).not.toContain('theme/demo-art-hosting');
    const submission = await checkTheme(dir, { env: { submission: true } });
    expect(submission.findings.map((f) => f.rule)).toContain('theme/demo-art-hosting');
  }, 60_000);
});
