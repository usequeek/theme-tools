import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  designsOf,
  groupTemplates,
  loadContext,
  TEMPLATE_DESIGNS_MAX,
  type BusinessVocabularyData,
  type ThemeDesign,
  type ThemeTemplate,
} from '@usequeek/theme-check';
import { appendDemoEntry, setDesignLabel } from './config-edit.js';
import { bundledLists, createLists, nearest, type BusinessLists } from './lists.js';
import { planTemplates } from './naming.js';
import { UsageError } from './options.js';
import { renameContent, SKELETON } from './rename.js';
import { buildDemoStore, optionalPagesOf, TEMPLATE_DESCRIPTION, type SkeletonStore } from './setup.js';
import skeletonData from './data/skeleton-store.json' with { type: 'json' };

/** The skeleton's store, bundled so `add` builds without a starter download. Must match fixtures/starter (add.test.ts fails on drift). */
const SKELETON_STORE = skeletonData as SkeletonStore;

/** Pickers over one resolved vocabulary copy (the command's `--offline`/`--vocabulary`, else bundled). */
export function vocabularyLists(data: BusinessVocabularyData, fallback: BusinessLists = bundledLists()): BusinessLists {
  return createLists({
    services: data.services,
    catalogue: data.catalogue,
    subcategories: data.subcategories,
    root_service: data.root_service,
    labels: data.labels ?? Object.fromEntries(fallback.businessKeys.map((key) => [key, fallback.labelOf(key)])),
  });
}

export interface AddPlan {
  /** Absolute theme folder. */
  dir: string;
  /** What was added, printed by `--json`. */
  added: Record<string, unknown>;
  /** Files written, absolute. */
  files: string[];
  /** File writes, in order. */
  writes: Array<{ path: string; content: string }>;
  /** The new theme.config.ts source (when the plan edits it). */
  configSource?: string;
}

interface ReadTheme {
  dir: string;
  slug: string;
  name: string;
  configSource: string;
  templates: ThemeTemplate[];
  designs: ThemeDesign[];
  /** Every store on disk, the primary first, with parsed data. */
  stores: Array<{ id: string; file: string; data: SkeletonStore | null }>;
}

async function readTheme(themeDir: string): Promise<ReadTheme> {
  const dir = resolve(themeDir);
  if (!existsSync(join(dir, 'theme.config.ts'))) {
    throw new UsageError(`No theme.config.ts in ${themeDir}: run this in a theme project (npm create @usequeek/theme), or pass --path.`);
  }
  if (!existsSync(join(dir, 'demo.json'))) {
    throw new UsageError(`No demo.json in ${themeDir}: the primary store is missing, so there is nothing to add to.`);
  }
  const context = await loadContext(dir);
  if (context.themeConfig === null || context.declaredDemos === null) {
    throw new UsageError('theme.config.ts could not be loaded. Fix it first — add writes nothing until it parses.');
  }
  const designs = designsOf({ ...(context.themeConfig as Record<string, unknown>), demos: context.declaredDemos });
  const name = (context.themeConfig as { name?: unknown }).name;
  return {
    dir,
    slug: context.slug,
    name: typeof name === 'string' && name.trim() !== '' ? name : context.slug,
    configSource: readFileSync(join(dir, 'theme.config.ts'), 'utf8'),
    templates: groupTemplates(designs),
    designs,
    stores: context.demos.map((store) => ({ id: store.id, file: store.file, data: (store.data ?? null) as SkeletonStore | null })),
  };
}

function templateChoices(theme: ReadTheme): string {
  return theme.templates.map((template) => template.key).filter((key): key is string => key !== null).join(', ');
}

/** A store object no other store in the theme uses: the cart is keyed by it. */
function uniqueShopId(theme: ReadTheme, candidate: string): void {
  const clash = theme.stores.find((store) => (store.data?.profile as { id?: unknown } | undefined)?.id === candidate);
  if (clash) throw new UsageError(`profile.id "${candidate}" is already used by ${clash.file}. Each store needs its own — the cart is keyed by it.`);
}

function checkBusiness(business: string, lists: BusinessLists): void {
  if (lists.businessKeys.includes(business)) return;
  const hint = nearest(business, lists.businessKeys);
  throw new UsageError(hint
    ? `Unknown business "${business}" — did you mean "${hint}"?`
    : `Unknown business "${business}". Choose from: ${lists.businessKeys.join(', ')}`);
}

function templateOf(theme: ReadTheme, key: string): ThemeTemplate {
  const template = theme.templates.find((candidate) => candidate.key === key);
  if (!template) {
    const hint = nearest(key, theme.templates.map((candidate) => candidate.key).filter((candidate): candidate is string => candidate !== null));
    throw new UsageError(hint
      ? `Unknown template "${key}" — did you mean "${hint}"? Templates: ${templateChoices(theme)}.`
      : `Unknown template "${key}". Templates: ${templateChoices(theme)}.`);
  }
  return template;
}

/**
 * Add a template for a vocabulary business key: a new demo store (the
 * skeleton's, built the same way `create` builds one per template) declared
 * as the template's design 1. At most the vocabulary and the duplicate
 * checks can refuse it.
 */
export async function planAddTemplate(themeDir: string, input: { business: string; label?: string }, lists: BusinessLists = bundledLists()): Promise<AddPlan> {
  const theme = await readTheme(themeDir);
  const business = input.business.trim();
  checkBusiness(business, lists);
  if (theme.templates.some((template) => template.key === business)) {
    throw new UsageError(`Template "${business}" already exists (design "${theme.templates.find((template) => template.key === business)!.designs[0]!.id}"). Each business gets one template; add a design to it instead: queek theme add design ${business} --label "<design label>".`);
  }
  if (theme.designs.some((design) => design.id === business)) {
    throw new UsageError(`Design id "${business}" is already taken, and template keys share one namespace with design ids. Pick another business.`);
  }
  const label = (input.label ?? lists.labelOf(business)).trim();
  if (!label) throw new UsageError('--label cannot be empty.');
  // The template's `for`, category first (contract R2.7): planTemplates
  // already computes it — a category leads with itself, a niche names only
  // its own key. The new template is never the primary, so its design 1 id
  // is its key, never `default`.
  const [planned] = planTemplates([business], business, lists);
  const forKeys = planned?.for ?? [business];
  // The skeleton renamed to this theme (what `create` runs on the starter
  // before building stores), with the prefix passes as no-ops: only the
  // slug, name and store ids move.
  const renamed = renameContent(JSON.stringify(SKELETON_STORE), '.json', SKELETON, { slug: theme.slug, prefix: SKELETON.prefix, name: theme.name });
  const primary = theme.stores.find((store) => store.id === 'default');
  const store = buildDemoStore(JSON.parse(renamed) as SkeletonStore, {
    slug: theme.slug,
    shopId: `demo-${theme.slug}-${business}`,
    pages: optionalPagesOf((primary?.data ?? {}) as SkeletonStore),
  });
  uniqueShopId(theme, `demo-${theme.slug}-${business}`);
  const entry = { id: business, template: business, label, for: forKeys, description: TEMPLATE_DESCRIPTION };
  return {
    dir: theme.dir,
    added: { type: 'template', template: business, id: business, label, for: forKeys },
    files: [join(theme.dir, 'demos', `${business}.json`), join(theme.dir, 'theme.config.ts')],
    writes: [
      { path: join(theme.dir, 'demos', `${business}.json`), content: `${JSON.stringify(store, null, 2)}\n` },
      { path: join(theme.dir, 'theme.config.ts'), content: appendDemoEntry(theme.configSource, entry) },
    ],
  };
}

/**
 * Add a design to a template: a copy of the template's first design with
 * fresh ids, declared `{ id, template, design_label }`. The id suggestion is
 * `<key>-2`, then `-3`; a 4th design is refused.
 */
export async function planAddDesign(themeDir: string, input: { template: string; label?: string; firstLabel?: string }): Promise<AddPlan> {
  const theme = await readTheme(themeDir);
  const template = templateOf(theme, input.template.trim());
  const key = template.key as string;
  if (template.designs.length >= TEMPLATE_DESIGNS_MAX) {
    throw new UsageError(`Template "${key}" already has ${template.designs.length} designs (${template.designs.map((design) => design.id).join(', ')}); a template has at most ${TEMPLATE_DESIGNS_MAX}. Make it a template of another business instead: queek theme add template <business>.`);
  }
  const taken = new Set([...theme.designs.map((design) => design.id), ...theme.templates.map((candidate) => candidate.key)]);
  const id = [`${key}-2`, `${key}-3`].find((candidate) => !taken.has(candidate));
  if (!id) throw new UsageError(`No free design id for template "${key}" (${key}-2 and ${key}-3 are both taken).`);
  const label = (input.label ?? '').trim();
  if (!label) throw new UsageError('--label <design label> names what tells this design from its template\'s others ("Grill house"). It is required.');
  const [first] = template.designs;
  const firstStore = theme.stores.find((store) => store.id === first!.id);
  if (!firstStore || !firstStore.data) throw new UsageError(`${first!.id === 'default' ? 'demo.json' : `demos/${first!.id}.json`} could not be read. Fix it first — add writes nothing until it parses.`);
  const needsFirstLabel = first!.designLabel === null;
  const firstLabel = (input.firstLabel ?? '').trim();
  if (needsFirstLabel && !firstLabel) {
    throw new UsageError(`Design "${first!.id}" has no design_label, and a template with ${template.designs.length + 1} designs needs one on each. Pass --first-label "<what tells ${first!.id} apart>" to name it.`);
  }
  // Fresh ids: its own profile id (the cart is keyed by it), matching shop
  // ids, and page ids under it — everything else stays the template's.
  const shopId = `demo-${theme.slug}-${id}`;
  uniqueShopId(theme, shopId);
  const source = structuredClone(firstStore.data) as SkeletonStore;
  const oldProfileId = (source.profile as { id?: unknown } | undefined)?.id;
  (source.profile as Record<string, unknown>).id = shopId;
  for (const product of source.products ?? []) {
    product.shop_id = shopId;
    if (product.shop && typeof product.shop === 'object') product.shop = { ...(product.shop as Record<string, unknown>), id: shopId };
  }
  if (typeof oldProfileId === 'string' && oldProfileId !== '') {
    for (const page of Object.values(source.pages ?? {})) {
      if (typeof page.id === 'string' && page.id.startsWith(oldProfileId)) page.id = `${shopId}${(page.id as string).slice(oldProfileId.length)}`;
    }
  }
  let configSource = appendDemoEntry(theme.configSource, { id, template: key, design_label: label, description: TEMPLATE_DESCRIPTION });
  if (needsFirstLabel) configSource = setDesignLabel(configSource, first!.id, firstLabel);
  return {
    dir: theme.dir,
    added: { type: 'design', template: key, id, design_label: label, ...(needsFirstLabel ? { first_label: firstLabel, first_design: first!.id } : {}) },
    files: [join(theme.dir, 'demos', `${id}.json`), join(theme.dir, 'theme.config.ts')],
    writes: [
      { path: join(theme.dir, 'demos', `${id}.json`), content: `${JSON.stringify(source, null, 2)}\n` },
      { path: join(theme.dir, 'theme.config.ts'), content: configSource },
    ],
  };
}

/** Where `add page` writes: the `--template` template's first design, a design id, or the primary. */
function targetStore(theme: ReadTheme, template: string | undefined): { id: string; file: string; data: SkeletonStore } {
  if (template === undefined || template.trim() === '') {
    const primary = theme.stores.find((store) => store.id === 'default');
    if (!primary?.data) throw new UsageError('demo.json could not be read. Fix it first — add writes nothing until it parses.');
    return { id: primary.id, file: primary.file, data: primary.data };
  }
  const wanted = template.trim();
  const byTemplate = theme.templates.find((candidate) => candidate.key === wanted);
  const designId = byTemplate ? byTemplate.designs[0]!.id : wanted;
  const store = theme.stores.find((candidate) => candidate.id === designId);
  if (!byTemplate && !store) {
    const hint = nearest(wanted, theme.templates.map((candidate) => candidate.key).filter((candidate): candidate is string => candidate !== null));
    throw new UsageError(hint
      ? `Unknown template "${wanted}" — did you mean "${hint}"? Templates: ${templateChoices(theme)}.`
      : `Unknown template "${wanted}". Templates: ${templateChoices(theme)}.`);
  }
  if (!store?.data) throw new UsageError(`${designId === 'default' ? 'demo.json' : `demos/${designId}.json`} could not be read. Fix it first — add writes nothing until it parses.`);
  return { id: store.id, file: store.file, data: store.data };
}

/**
 * Add an optional page (contact, faq) to a design's store, from the
 * skeleton's page — plus the skeleton's menu item for it when the store's
 * header menu lacks one. A page the store already has is refused.
 */
export async function planAddPage(themeDir: string, input: { page: string; template?: string }): Promise<AddPlan> {
  if (input.page !== 'contact' && input.page !== 'faq') {
    throw new UsageError(`Unknown page "${input.page}". Choose from: contact, faq.`);
  }
  const theme = await readTheme(themeDir);
  const target = targetStore(theme, input.template);
  const pages = target.data.pages ?? {};
  if (input.page in pages) {
    throw new UsageError(`Design "${target.id}" already has a ${input.page} page (${target.file}). Nothing was written.`);
  }
  const skeletonPages = (SKELETON_STORE.pages ?? {}) as Record<string, Record<string, unknown>>;
  const skeletonPage = skeletonPages[input.page];
  if (!skeletonPage) throw new Error(`The bundled skeleton has no ${input.page} page.`);
  const page = structuredClone(skeletonPage) as Record<string, unknown>;
  const profileId = (target.data.profile as { id?: unknown } | undefined)?.id;
  if (typeof page.id === 'string' && typeof profileId === 'string' && page.id.startsWith('demo-bare')) {
    page.id = `${profileId}${(page.id as string).slice('demo-bare'.length)}`;
  }
  const store = structuredClone(target.data) as SkeletonStore;
  store.pages = { ...pages, [input.page]: page };
  // The skeleton's menu item for the page (faq has one; contact does not),
  // restored when the store's header menu lacks it — the inverse of create
  // dropping it when the page is not written.
  const skeletonItem = (SKELETON_STORE.menus ?? [])
    .flatMap((menu) => menu.items ?? [])
    .find((item) => item.type === 'page' && item.ref === input.page);
  const menus = store.menus ?? [];
  const header = menus.find((menu) => menu.location === 'header' && Array.isArray(menu.items)) ?? menus.find((menu) => Array.isArray(menu.items));
  if (skeletonItem && header && !header.items!.some((item) => item.type === 'page' && item.ref === input.page)) {
    header.items = [...header.items!, structuredClone(skeletonItem)];
  }
  const path = join(theme.dir, target.file);
  return {
    dir: theme.dir,
    added: { type: 'page', page: input.page, design: target.id },
    files: [path],
    writes: [{ path, content: `${JSON.stringify(store, null, 2)}\n` }],
  };
}

/** Write a plan's files, creating folders. Every path must stay inside the theme folder. */
export function applyAddPlan(plan: AddPlan): void {
  for (const write of plan.writes) {
    const relativePath = relative(plan.dir, write.path);
    // `relative` answers with the platform's separator (`demos\x.json` on Windows), and
    // with an absolute path when the file is on another drive.
    if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error(`Refusing to write outside the theme folder: ${write.path}`);
    }
    mkdirSync(dirname(write.path), { recursive: true });
    writeFileSync(write.path, write.content);
  }
}
