import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TemplatePlan } from './naming.js';
import { SKELETON, renameTheme } from './rename.js';

export type OptionalPage = 'contact' | 'faq';
export type Assistant = 'claude' | 'gemini';

export interface Answers {
  name: string;
  slug: string;
  prefix: string;
  templates: TemplatePlan[];
  categories: string[];
  tags: string[];
  pages: OptionalPage[];
  ai: Assistant[] | false;
}

/** Written for every template, whatever the developer picks. */
const REQUIRED_PAGES = ['home', 'shop', 'about', 'sales', 'landing'];
/** Must start with the text the check rejects, so no template ships with it. */
const DESCRIPTION = 'Replace before publishing. Who this template fits, the look, its signature sections and the photos it needs, in at most 300 characters.';

const ts = (text: string): string => {
  const escaped = text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
    .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
  return `'${escaped}'`;
};
const list = (items: string[]): string => `[${items.map(ts).join(', ')}]`;

export function themeConfigSource(answers: Answers): string {
  const [primary, ...others] = answers.templates;
  const demos = others.map((plan) => `    {\n      id: ${ts(plan.id)}, template: ${ts(plan.template)}, label: ${ts(plan.label)}, for: ${list(plan.for)},\n      description: ${ts(DESCRIPTION)},\n    },`).join('\n');
  return `const config = {
  name: ${ts(answers.name)},
  slug: ${ts(answers.slug)},
  author: '',
  description: ${ts('Replace before publishing. What this theme is, in one sentence.')},
  version: '0.1.0',
  tags: ${list(answers.tags)},
  categories: ${list(answers.categories)},
  rank: 0,
  // Theme → template → design (docs/THEME.md#templates). A template is a
  // business the theme is dressed as; a design is one demo store of it.
  // demo.json is the main template's first design; each demos/<id>.json here
  // is the first design of another template, so its id is its key.
  // \`template\` is that key: a slug for the business, never renamed once
  // shipped. \`label\` and \`for\` are the template's. \`for\`: a whole business
  // leads with its category, a niche names only its product keys
  // (docs/business-vocabulary.json).
  // To give a template a second design, add a demos/<id>.json with any unused
  // id and declare it \`{ id, template, design_label, description }\`: it
  // inherits the template's label and for. A template with two or more
  // designs (three at most) names each one by its own \`design_label\`.
  default_demo: {
    template: ${ts(primary.template)},
    label: ${ts(primary.label)},
    for: ${list(primary.for)},
    description: ${ts(DESCRIPTION)},
  },
  demos: [
${demos}
  ],
};

export default config;
`;
}

type Menu = { items?: MenuItem[] };
type MenuItem = { type?: string; ref?: string; children?: MenuItem[] };

function dropMissingPages(items: MenuItem[] | undefined, pages: Set<string>): MenuItem[] | undefined {
  return items
    ?.filter((item) => item.type !== 'page' || (typeof item.ref === 'string' && pages.has(item.ref)))
    .map((item) => ({ ...item, ...(item.children ? { children: dropMissingPages(item.children, pages) } : {}) }));
}

function writeDemoStores(themeDir: string, answers: Answers): void {
  const skeleton = JSON.parse(readFileSync(join(themeDir, 'demo.json'), 'utf8'));
  const keep = new Set([...REQUIRED_PAGES, ...answers.pages]);
  for (const plan of answers.templates) {
    const store = structuredClone(skeleton);
    const shopId = plan.primary ? `demo-${answers.slug}` : `demo-${answers.slug}-${plan.id}`;
    store.profile = { ...store.profile, id: shopId };
    for (const product of store.products ?? []) {
      product.shop_id = shopId;
      if (product.shop) product.shop = { ...product.shop, id: shopId };
    }
    store.pages = Object.fromEntries(Object.entries(store.pages as Record<string, { id?: string }>)
      .filter(([slug]) => keep.has(slug))
      .map(([slug, page]) => [slug, { ...page, ...(typeof page.id === 'string' ? { id: page.id.replace(`demo-${answers.slug}`, shopId) } : {}) }]));
    store.menus = (store.menus as Menu[] | undefined)?.map((menu) => ({ ...menu, items: dropMissingPages(menu.items, keep) }));
    const path = plan.primary ? join(themeDir, 'demo.json') : join(themeDir, 'demos', `${plan.id}.json`);
    mkdirSync(join(themeDir, 'demos'), { recursive: true });
    writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`);
  }
}

function keepAssistants(projectDir: string, ai: Assistant[] | false): void {
  const remove = (path: string): void => rmSync(join(projectDir, path), { recursive: true, force: true });
  if (ai === false) {
    for (const path of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.claude']) remove(path);
    return;
  }
  if (!ai.includes('claude')) {
    remove('CLAUDE.md');
    remove('.claude');
  }
  if (!ai.includes('gemini')) remove('GEMINI.md');
}

/** Turn a downloaded starter into the developer's theme. Pure file work: no network, no install. */
export function setupTheme(projectDir: string, answers: Answers): void {
  const themeDir = join(projectDir, 'theme');
  renameTheme(themeDir, SKELETON, { slug: answers.slug, prefix: answers.prefix, name: answers.name });
  writeFileSync(join(themeDir, 'theme.config.ts'), themeConfigSource(answers));
  writeDemoStores(themeDir, answers);
  rmSync(join(themeDir, 'theme.jpg'), { force: true });
  keepAssistants(projectDir, answers.ai);
  const manifest = join(projectDir, 'package.json');
  if (existsSync(manifest)) {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    writeFileSync(manifest, `${JSON.stringify({ ...pkg, name: answers.slug }, null, 2)}\n`);
  }
}
