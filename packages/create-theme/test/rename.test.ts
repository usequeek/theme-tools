import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SKELETON, renameContent, renameTheme } from '../src/rename.js';
import { starterProject } from './helpers.js';

const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});
const TO = { slug: 'mo-laundry', prefix: 'ml', name: "Mọ́ Laundry's" };

describe('renameTheme', () => {
  const theme = join(starterProject(), 'theme');
  renameTheme(theme, SKELETON, TO);

  it('leaves no skeleton identity token anywhere', () => {
    for (const file of walk(theme).filter((path) => /\.(tsx?|css|json|md)$/.test(path))) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/(?<![\w])[Bb]are(?![\w])|(?<![\w-])bare-/);
    }
  });

  it('renames every class token, the second one in a className too', () => {
    expect(readFileSync(join(theme, 'pages/product.tsx'), 'utf8')).toContain('className="ml-main ml-product"');
  });

  it('renames the identity the checker compares', () => {
    expect(readFileSync(join(theme, 'manifest.ts'), 'utf8')).toContain("slug: 'mo-laundry'");
    expect(readFileSync(join(theme, 'layout.tsx'), 'utf8')).toContain('theme-mo-laundry');
    const demo = JSON.parse(readFileSync(join(theme, 'demo.json'), 'utf8'));
    expect(demo.profile).toMatchObject({ id: 'demo-mo-laundry', slug: 'mo-laundry', name: "Mọ́ Laundry's" });
    expect(demo.config.theme).toBe('mo-laundry');
  });
});

// "simply bare" used to come out as "simply simply-bare": the slug pass ran over the name it had just written.
describe('renameTheme when the new identity holds the skeleton token', () => {
  const theme = join(starterProject(), 'theme');
  const to = { slug: 'barefoot-bare', prefix: 'bb', name: 'simply bare' };
  renameTheme(theme, SKELETON, to);
  const demo = JSON.parse(readFileSync(join(theme, 'demo.json'), 'utf8'));

  it('writes the display name exactly as given', () => {
    expect(demo.profile).toMatchObject({ id: 'demo-barefoot-bare', slug: 'barefoot-bare', name: 'simply bare' });
    expect(demo.pages.about.seo.title).toBe('About — simply bare');
    expect(readFileSync(join(theme, 'theme.config.ts'), 'utf8')).toContain("name: 'simply bare',");
  });

  it('writes the slug, root class and class prefix exactly as given', () => {
    expect(readFileSync(join(theme, 'theme.config.ts'), 'utf8')).toContain("slug: 'barefoot-bare',");
    expect(demo.config.theme).toBe('barefoot-bare');
    expect(readFileSync(join(theme, 'layout.tsx'), 'utf8')).toContain('theme-barefoot-bare');
    expect(readFileSync(join(theme, 'pages/product.tsx'), 'utf8')).toContain('className="bb-main bb-product"');
  });
});

describe('renameContent', () => {
  it('renames the name and the slug in one pass, so neither rewrites the other', () => {
    expect(renameContent("name: 'Bare', slug: 'bare'", '.ts', SKELETON, { slug: 'simply-bare', prefix: 'sb', name: 'simply bare' }))
      .toBe("name: 'simply bare', slug: 'simply-bare'");
    expect(renameContent('"name": "Bare", "slug": "bare"', '.json', SKELETON, { slug: 'bare-bones', prefix: 'bb', name: 'Bare Bones' }))
      .toBe('"name": "Bare Bones", "slug": "bare-bones"');
  });

  it('escapes the display name for the file it lands in', () => {
    expect(renameContent("name: 'Bare',", '.ts', SKELETON, TO)).toBe("name: 'Mọ́ Laundry\\'s',");
    expect(renameContent('{"name": "Bare"}', '.json', SKELETON, { ...TO, name: 'Say "hi"' })).toBe('{"name": "Say \\"hi\\""}');
  });

  it('treats $& and $$ in slug and prefix as literals, not replacement sequences', () => {
    expect(renameContent('theme-bare bare-main bare', '.css', SKELETON, { slug: 'a$&b', prefix: 'p$$', name: 'N' })).toBe('theme-a$&b p$$-main a$&b');
  });

  it('escapes line terminators in display names for TypeScript', () => {
    expect(renameContent("name: 'Bare',", '.ts', SKELETON, { ...TO, name: 'A\nB' })).toBe("name: 'A\\nB',");
  });
});

const MEDLEY = { slug: 'medley', prefix: 'md', name: 'Medley' };
const PROBE = { slug: 'zzprobe', prefix: 'zq', name: 'Zzprobe' };

describe('renameContent on a real theme (medley → zzprobe)', () => {
  it('renames CSS custom properties and their var() uses', () => {
    const css = ':root { --md-accent: #b00; }\n.md-card { color: var(--md-accent); border-color: var(--md-accent-wash); }';
    const out = renameContent(css, '.css', MEDLEY, PROBE);
    expect(out).toContain('--zq-accent:');
    expect(out).toContain('var(--zq-accent)');
    expect(out).toContain('var(--zq-accent-wash)');
    expect(out).toContain('.zq-card');
    expect(out).not.toContain('md-accent');
  });

  it('renames data attributes and their selectors', () => {
    const tsx = '<div data-md-open={open} className="md-sheet">\n{/* [data-md-open] */}';
    const css = '[data-md-open="true"] { display: block; }';
    expect(renameContent(tsx, '.tsx', MEDLEY, PROBE)).toContain('data-zq-open');
    expect(renameContent(css, '.css', MEDLEY, PROBE)).toContain('[data-zq-open="true"]');
    expect(renameContent(css, '.css', MEDLEY, PROBE)).not.toContain('data-md-open');
  });

  it('renames component heads but leaves the standalone display name to the name pass', () => {
    const tsx = 'export function MedleyModalLayer() { return <MedleyHeader />; } // Medley theme';
    const out = renameContent(tsx, '.tsx', MEDLEY, PROBE);
    expect(out).toContain('ZzprobeModalLayer');
    expect(out).toContain('<ZzprobeHeader />');
    expect(out).toContain('// Zzprobe theme');
    expect(out).not.toMatch(/Medley[A-Z]/);
  });

  it('derives the component head from a multi-word display name', () => {
    const from = { slug: 'sole', prefix: 'st', name: 'Sole Theory' };
    const to = { slug: 'zzprobe', prefix: 'zq', name: 'Zz Probe' };
    const out = renameContent('function SoleTheoryHeader() { return <SoleTheoryMark />; }', '.tsx', from, to);
    expect(out).toBe('function ZzProbeHeader() { return <ZzProbeMark />; }');
  });

  it('renames demo store ids: the slug followed by more id', () => {
    const json = '{"profile": {"id": "medley-food"}, "products": [{"shop_id": "medley-food-2"}]}';
    const out = renameContent(json, '.json', MEDLEY, PROBE);
    expect(JSON.parse(out)).toMatchObject({ profile: { id: 'zzprobe-food' }, products: [{ shop_id: 'zzprobe-food-2' }] });
  });

  it('never rewrites inside URLs, while the same slug beside them is renamed', () => {
    const json = '{"banner": "https://media.usequeek.com/theme-assets/medley/abc.jpg", "theme": "medley"}';
    const out = renameContent(json, '.json', MEDLEY, PROBE);
    expect(out).toContain('https://media.usequeek.com/theme-assets/medley/abc.jpg');
    expect(out).toContain('"theme": "zzprobe"');
  });

  it('rewrites preview paths to the new slug: the demo is the new theme’s own store', () => {
    expect(renameContent('// previewed at /medley~<id>', '.ts', MEDLEY, PROBE)).toBe('// previewed at /zzprobe~<id>');
  });
});

describe('renameTheme end to end on a real-theme-like fixture', () => {
  it('leaves no old identity outside URLs', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'rename-e2e-'));
    writeFileSync(join(dir, 'theme.css'), ':root { --md-accent: #b00; }\n.md-card { color: var(--md-accent); }\n[data-md-open] { display: block; }\n');
    writeFileSync(join(dir, 'layer.tsx'), 'export function MedleyModalLayer() { return <div data-md-open className="md-sheet"><MedleyHeader /></div>; }\n');
    writeFileSync(
      join(dir, 'demo.json'),
      JSON.stringify({ profile: { id: 'medley-food', slug: 'medley', name: 'Medley' }, products: [{ shop_id: 'medley-food-2', image: 'https://media.usequeek.com/theme-assets/medley/abc.jpg' }] }, null, 2),
    );
    mkdirSync(join(dir, 'docs'));
    writeFileSync(join(dir, 'docs', 'notes.md'), '# Medley\nThe medley theme. See https://media.usequeek.com/theme-assets/medley/abc.jpg and /medley~food.\n');

    renameTheme(dir, MEDLEY, PROBE);

    const files = readdirSync(dir).filter((name) => name !== 'docs');
    const bodies = [...files.map((name) => readFileSync(join(dir, name), 'utf8')), readFileSync(join(dir, 'docs/notes.md'), 'utf8')];
    const withoutUrls = bodies.map((body) => body.replace(/https?:\/\/[^\s'"`<>]*/g, ''));
    for (const [index, body] of withoutUrls.entries()) {
      expect(body, String(index)).not.toMatch(/Medley|medley|--md-|data-md-/);
    }
    const demo = JSON.parse(readFileSync(join(dir, 'demo.json'), 'utf8'));
    expect(demo.products[0].image).toBe('https://media.usequeek.com/theme-assets/medley/abc.jpg');
    expect(demo).toMatchObject({ profile: { id: 'zzprobe-food' }, products: [{ shop_id: 'zzprobe-food-2' }] });
    expect(readFileSync(join(dir, 'docs/notes.md'), 'utf8')).toContain('/zzprobe~food');
  });
});

describe('the package entry', () => {
  // Queek's `yarn theme:new` copies a theme under a new name with this rename.
  it('exports the rename and the skeleton identity', async () => {
    const api = await import('../src/index.js');
    expect(api.renameTheme).toBe(renameTheme);
    expect(api.SKELETON).toEqual({ slug: 'bare', prefix: 'bare', name: 'Bare' });
  });
});
