import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkTheme, rejects } from '../src/index.js';

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

describe('checkTheme on a real theme folder', () => {
  it('passes the skeleton, naming files relative to where it runs', async () => {
    const { context, findings } = await checkTheme(FIXTURE, { env: { root: 'theme/' } });
    expect(context.slug).toBe('bare');
    expect(rejects(findings)).toEqual([]);
    expect(findings.every((f) => !f.where || f.where.startsWith('theme/'))).toBe(true);
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
