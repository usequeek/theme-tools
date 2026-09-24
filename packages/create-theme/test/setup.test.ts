import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { planTemplates } from '../src/naming.js';
import { setupTheme, type Answers } from '../src/setup.js';
import { starterProject } from './helpers.js';

const answers = (overrides: Partial<Answers> = {}): Answers => ({
  name: 'Mọ́ Laundry', slug: 'mo-laundry', prefix: 'ml',
  templates: planTemplates(['laundry', 'foods']), categories: ['laundry', 'foods'], tags: ['minimal'],
  pages: ['contact'], ai: ['claude'], ...overrides,
});
const json = (dir: string, path: string) => JSON.parse(readFileSync(join(dir, path), 'utf8'));

describe('setupTheme', () => {
  const dir = starterProject();
  setupTheme(dir, answers());

  it('writes theme.config.ts from the answers', () => {
    const config = readFileSync(join(dir, 'theme/theme.config.ts'), 'utf8');
    expect(config).toContain("slug: 'mo-laundry'");
    expect(config).toContain("tags: ['minimal']");
    expect(config).toContain("categories: ['laundry', 'foods']");
    expect(config).toContain("for: ['laundry']");
    expect(config).toContain("id: 'foods', label: 'Food & restaurants', for: ['foods']");
    expect(config.match(/description: 'Replace before publishing\./g)).toHaveLength(3);
  });

  it('writes one demo store per template, each its own shop', () => {
    const primary = json(dir, 'theme/demo.json');
    const foods = json(dir, 'theme/demos/foods.json');
    expect(primary.profile.id).toBe('demo-mo-laundry');
    expect(foods.profile.id).toBe('demo-mo-laundry-foods');
    expect(new Set(foods.products.map((p: { shop_id: string }) => p.shop_id))).toEqual(new Set(['demo-mo-laundry-foods']));
  });

  it('keeps the required pages and exactly the chosen optional ones', () => {
    const pages = Object.keys(json(dir, 'theme/demos/foods.json').pages).sort();
    expect(pages).toEqual(['about', 'contact', 'home', 'landing', 'sales', 'shop']);
    const menu = JSON.stringify(json(dir, 'theme/demo.json').menus);
    expect(menu).not.toContain('"ref":"faq"');
  });

  it("deletes the skeleton's screenshot — it is the developer's to capture", () => {
    expect(existsSync(join(dir, 'theme/theme.jpg'))).toBe(false);
  });

  it('keeps AGENTS.md and the chosen assistants only', () => {
    expect(existsSync(join(dir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(dir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(dir, '.claude/skills/queek-theme/SKILL.md'))).toBe(true);
    expect(existsSync(join(dir, 'GEMINI.md'))).toBe(false);
  });

  it('names the package after the slug', () => {
    expect(json(dir, 'package.json').name).toBe('mo-laundry');
  });

  it('removes every AI file with --no-ai', () => {
    const bare = starterProject();
    setupTheme(bare, answers({ ai: false }));
    for (const file of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.claude']) expect(existsSync(join(bare, file)), file).toBe(false);
  });
});
