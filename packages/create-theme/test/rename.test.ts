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

describe('renameContent', () => {
  it('escapes the display name for the file it lands in', () => {
    expect(renameContent("name: 'Bare',", '.ts', SKELETON, TO)).toBe("name: 'Mọ́ Laundry\\'s',");
    expect(renameContent('{"name": "Bare"}', '.json', SKELETON, { ...TO, name: 'Say "hi"' })).toBe('{"name": "Say \\"hi\\""}');
  });

  it('treats $& and $$ in slug and prefix as literals, not replacement sequences', () => {
    expect(renameContent('theme-bare bare-main bare', '.css', SKELETON, { slug: 'a$&b', prefix: 'p$$', name: 'N' })).toBe('theme-a$&b p$$-main a$&b');
  });
});
