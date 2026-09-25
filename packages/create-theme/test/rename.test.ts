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

describe('the package entry', () => {
  // Queek's `yarn theme:new` copies a theme under a new name with this rename.
  it('exports the rename and the skeleton identity', async () => {
    const api = await import('../src/index.js');
    expect(api.renameTheme).toBe(renameTheme);
    expect(api.SKELETON).toEqual({ slug: 'bare', prefix: 'bare', name: 'Bare' });
  });
});
