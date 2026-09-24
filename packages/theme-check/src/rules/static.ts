import { join, relative } from 'node:path';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { foreignImageRefs } from '../utils/theme-demo-images.js';
import { DEMO_ID_FORMAT, PRIMARY_DEMO_ID } from '../utils/theme-demos.js';
import { SCREENSHOT_LOCK, TEMPLATE_DESCRIPTION_MAX, TEMPLATE_DESCRIPTION_PLACEHOLDER, declaredFieldsByVariant, isPresentationalField, screenshotFile, screenshotUrl, sectionCopy } from '../utils/theme-templates.js';
import { copyViolations, isTestimonialSection } from '../utils/template-copy.js';
import { BUSINESS_KEYS, isBusinessKey } from '../utils/business-vocabulary.js';
import { themeSourceFiles } from '../context.js';
import { finding, type DemoStore, type Finding, type Rule, type ThemeContext } from '../types.js';


const REQUIRED_FILES = [
  'index.ts', 'manifest.ts', 'theme.config.ts',
  'layout.tsx', 'header.tsx', 'footer.tsx',
  'theme.css', 'demo.json',
];
/** Theme-owned blocks only — divider/embed/video/table/button/image are framework-owned. */
const REQUIRED_BLOCKS = ['gallery', 'products', 'categories'];
const REQUIRED_PAGES = ['home', 'page', 'blog', 'post', 'collection', 'product', 'gallery-page'];
const REQUIRED_SHELLS = ['cart-shell', 'login-shell', 'signup-shell', 'account-shell'];
const SCREENSHOTS = ['theme.jpg', 'theme.png'];


/** Crude but sufficient: keeps a prose mention of a tag from reading as markup. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

export const structureRule: Rule = {
  id: 'theme/structure',
  summary: 'Every required file, block, page and shell is present',
  kind: 'static',
  run(context) {
    const missing = (paths: string[], label: string): Finding[] =>
      paths.filter((path) => !context.exists(path)).map((path) =>
        finding(context, 'theme/structure', 'reject', {
          where: `${context.env.root}${path}`,
          found: `missing ${label}: ${path}`,
          fix: `Create ${path}. ${context.env.scaffold} scaffolds a complete set — copy the shape from it.`,
          docs: `${context.env.docs}#required-files`,
        }));

    // A chrome-only theme (declares no page-block variants — themes/default)
    // renders one page and lets core supply the rest, so the page-based
    // structure is not its contract. Derived from the manifest, not a name.
    const findings = [
      ...missing(REQUIRED_FILES.filter((file) => file !== 'index.ts' || !context.exists('index.tsx')), 'required file'),
      ...(context.pageBased ? [
        ...missing(REQUIRED_BLOCKS.map((b) => `blocks/${b}.tsx`), 'theme-owned block'),
        ...missing(REQUIRED_PAGES.map((p) => `pages/${p}.tsx`), 'page'),
        ...missing(REQUIRED_SHELLS.map((s) => `shells/${s}.tsx`), 'shell'),
      ] : []),
    ];

    if (!SCREENSHOTS.some(context.exists)) {
      findings.push(finding(context, 'theme/structure', 'reject', {
        where: `${context.env.root}`,
        found: `no theme screenshot (${SCREENSHOTS.join(' or ')})`,
        fix: `Capture the homepage at 1280×800 from ${context.env.preview('default')} and save it as theme.jpg.`,
        docs: `${context.env.docs}#theme-png`,
      }));
    }

    return findings;
  },
};

/** The stores a rule runs over, the primary first — plus a synthetic missing
 *  primary, so "there is no demo.json" is a finding and not a silent skip. */
function storesOf(context: ThemeContext): DemoStore[] {
  const stores = [...context.demos];
  if (!stores.some((store) => store.id === PRIMARY_DEMO_ID)) stores.unshift({ id: PRIMARY_DEMO_ID, file: 'demo.json', data: null });
  return stores;
}

export const demoStoreRule: Rule = {
  id: 'theme/demo-store',
  summary: 'Every demo store is a believable store that identifies itself as this theme',
  kind: 'static',
  run(context) {
    const findings: Finding[] = [];

    for (const store of storesOf(context)) {
      const at = `${context.env.root}${store.file}`;
      const demo = store.data;
      if (!demo) {
        findings.push(finding(context, 'theme/demo-store', 'reject', {
          where: at,
          found: 'missing or not valid JSON',
          fix: store.id === PRIMARY_DEMO_ID
            ? 'demo.json is both the vendor-facing preview and what the backend builder composes real stores from. It cannot be skipped.'
            : 'An alternative store is previewed and published like the primary — it has to parse.',
          docs: `${context.env.docs}#demojson`,
        }));
        continue;
      }

      const add = (found: string, fix: string): void => {
        findings.push(finding(context, 'theme/demo-store', 'reject', { where: at, found, fix, docs: `${context.env.docs}#demojson` }));
      };

      const profile = demo.profile as { id?: string; slug?: string } | undefined;
      const config = demo.config as { theme?: string } | undefined;
      if (profile?.slug !== context.slug) add(`profile.slug is "${profile?.slug ?? 'unset'}"`, `Set profile.slug to "${context.slug}".`);
      if (config?.theme !== context.slug) add(`config.theme is "${config?.theme ?? 'unset'}"`, `Set config.theme to "${context.slug}".`);

      // The cart is keyed by the product's shop_id and the preview seeds it
      // by profile.id. A product that belongs to another shop id cannot be
      // bought in its own preview — and two stores that share one bleed
      // their carts into each other.
      const products = Array.isArray(demo.products) ? (demo.products as Array<{ shop_id?: string }>) : [];
      const foreign = [...new Set(products.map((product) => product.shop_id).filter((id) => id !== profile?.id))];
      if (profile?.id && foreign.length > 0) {
        add(
          `products carry shop_id ${foreign.map((id) => `"${id ?? 'unset'}"`).join(', ')} but profile.id is "${profile.id}"`,
          `Set every products[].shop_id to "${profile.id}" — the cart and the preview checkout key on it.`,
        );
      }

      const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0);
      const minimums: Array<[string, number, number]> = [
        ['products', count(demo.products), 6],
        ['categories', count(demo.categories), 3],
        ['posts', count(demo.posts), 1],
        ['menus', count(demo.menus), 1],
        ['pages', Object.keys((demo.pages as Record<string, unknown>) ?? {}).length, 4],
      ];
      for (const [key, actual, required] of minimums) {
        if (actual < required) {
          add(`${key}: ${actual}`, `Needs at least ${required}. A sparse demo store does not sell the theme, and the builder composes from it.`);
        }
      }
    }

    return findings;
  },
};

/**
 * The declaration in theme.config.ts and the files under demos/ are one list.
 * A declared store with no file 404s in the preview the registry advertises;
 * a file nobody declared is previewable but never offered; an id that is not
 * a slug cannot be a URL segment; two stores on one profile.id share a cart.
 */
export const demoStoresRule: Rule = {
  id: 'theme/demo-stores',
  summary: 'demos/ and the `demos` declaration in theme.config.ts agree',
  kind: 'static',
  run(context) {
    const findings: Finding[] = [];
    const at = `${context.env.root}theme.config.ts`;
    const add = (where: string, found: string, fix: string): void => {
      findings.push(finding(context, 'theme/demo-stores', 'reject', { where, found, fix, docs: `${context.env.docs}#alternative-demo-stores` }));
    };

    const declared = context.declaredDemos ?? [];
    const secondaries = context.demos.filter((store) => store.id !== PRIMARY_DEMO_ID);

    for (const demo of declared) {
      const id = String(demo?.id ?? '');
      if (id === PRIMARY_DEMO_ID) {
        add(at, `demos[] declares "default" — "default" is reserved for demo.json`, 'Remove it; the primary store is demo.json and needs no declaration.');
        continue;
      }
      if (!DEMO_ID_FORMAT.test(id)) {
        add(at, `demos[] id "${id}" is not a slug`, 'Use lowercase letters, digits and single hyphens — the id becomes a URL segment (`/<slug>~<id>`) and a filename.');
        continue;
      }
      if (!secondaries.some((store) => store.id === id)) {
        add(at, `demos[] declares "${id}" but there is no file ${context.env.root}demos/${id}.json`, 'Add the store, or drop the declaration. The registry advertises a preview URL for every declared store.');
      }
      if (typeof demo.label !== 'string' || demo.label.trim() === '') {
        add(at, `demos[] "${id}" has no label`, 'Give it the name a merchant sees, e.g. "Restaurant & takeaway".');
      }
      if (!Array.isArray(demo.for) || demo.for.length === 0 || demo.for.some((v) => typeof v !== 'string' || v.trim() === '')) {
        add(at, `demos[] "${id}" has no \`for\` business list`, `List the businesses this store is for, most specific first, from ${context.env.vocabulary} (service slugs like "foods", catalogue keys like "wigs-extensions-hair-accessories"). The backend offers it to matching vendors.`);
      }
    }

    for (const store of secondaries) {
      if (store.id === PRIMARY_DEMO_ID) {
        add(`${context.env.root}${store.file}`, '"default" is reserved for demo.json', 'Rename the file — or fold it into demo.json if it is the primary.');
        continue;
      }
      if (!DEMO_ID_FORMAT.test(store.id)) {
        add(`${context.env.root}${store.file}`, `"${store.id}" is not a slug`, 'Name the file with lowercase letters, digits and single hyphens — it becomes a URL segment.');
        continue;
      }
      if (!declared.some((demo) => demo?.id === store.id)) {
        add(`${context.env.root}${store.file}`, `demos/${store.id}.json is not declared in theme.config.ts`, `Add \`{ id: '${store.id}', label, for: [...] }\` to \`demos\` in theme.config.ts, or remove the file. An undeclared store is previewable but never offered to anyone.`);
      }
    }

    const seen = new Map<string, string>();
    for (const store of context.demos) {
      const id = (store.data?.profile as { id?: string } | undefined)?.id;
      if (!id) continue;
      const first = seen.get(id);
      if (first) {
        add(`${context.env.root}${store.file}`, `profile.id "${id}" is already used by ${first}`, 'Give each store its own profile.id (and matching products[].shop_id) — the cart is keyed by it, so two stores on one id share a cart in the preview.');
      } else {
        seen.set(id, store.file);
      }
    }

    return findings;
  },
};

export const demoArtRule: Rule = {
  id: 'theme/demo-art-hosting',
  summary: 'Every demo image, in every store, is served from Queek — not a foreign host or a local file',
  kind: 'static',
  run(context) {
    // Queek moves demo art onto its CDN when a theme is submitted, so a
    // developer references any public URL; only the submission run checks it.
    if (context.retired || !context.env.submission) return [];

    return context.demos.flatMap((store) =>
      foreignImageRefs(store.data).map((ref) =>
        finding(context, 'theme/demo-art-hosting', 'reject', {
          where: `${context.env.root}${store.file}`,
          found: `image served from elsewhere: ${ref}`,
          fix: `Inside this repo, run \`yarn theme:check ${context.slug} --fix\` (or \`yarn theme:rehost-images --theme ${context.slug}\`) and commit the rewritten ${store.file}. Submitting from outside? Leave it — \`theme:pull\` rehosts your art at publish time. Your art reaches real stores through the registry, so it cannot ship on a host we do not control.`,
          fixable: true,
          docs: `${context.env.docs}#demo-art-hosting-mandatory`,
        })));
  },
};

export const codeQualityRule: Rule = {
  id: 'theme/code-quality',
  summary: 'Header wiring, client directives, and no cross-theme imports',
  kind: 'static',
  run(context) {
    const findings: Finding[] = [];
    const headerSources = (): string => {
      const header = context.read('header.tsx') ?? '';
      const dir = context.file('headers');
      const variants = existsSync(dir)
        ? readdirSync(dir).map((name) => readFileSync(`${dir}/${name}`, 'utf8'))
        : [];
      return [header, ...variants].join('\n');
    };

    const headers = headerSources();
    if (/<button[^>]*logo-btn/.test(headers) || /<button[^>]*brand"/.test(headers)) {
      findings.push(finding(context, 'theme/code-quality', 'reject', {
        where: `${context.env.root}header.tsx`,
        found: 'the logo is a <button>',
        fix: 'Use <Link href={`/${vendor.slug}`}>. A button is not navigable, crawlable, or middle-clickable.',
        docs: `${context.env.docs}#component-rules`,
      }));
    }
    if (!/menuItemToHref|menuItem\(/.test(headers)) {
      findings.push(finding(context, 'theme/code-quality', 'reject', {
        where: `${context.env.root}header.tsx`,
        found: 'menu links are built by hand',
        fix: 'Use menuItemToHref() from @usequeek/theme-kit/utils/menu-link — it resolves subdomain vs path-based vendors.',
        docs: `${context.env.docs}#component-rules`,
      }));
    }

    for (const file of ['header.tsx', 'blocks/products.tsx', 'blocks/categories.tsx', 'blocks/gallery.tsx']) {
      const source = context.read(file);
      if (source && !source.startsWith("'use client'")) {
        findings.push(finding(context, 'theme/code-quality', 'reject', {
          where: `${context.env.root}${file}`,
          found: 'uses hooks without a client directive',
          fix: "Add 'use client' as the first line.",
          docs: `${context.env.docs}#component-rules`,
        }));
      }
    }

    for (const path of themeSourceFiles(context.dir)) {
      const source = readFileSync(path, 'utf8');

      // JSX only, comments stripped: `<img>` is a perfectly normal thing to
      // mention in a docblock, and three themes do.
      if (path.endsWith('.tsx') && /<img[\s>]/.test(stripComments(source))) {
        findings.push(finding(context, 'theme/code-quality', 'reject', {
          where: relative(context.dir, path),
          found: 'renders a raw <img>',
          fix: "Use <Image /> from @usequeek/theme-kit/components/image. It carries the broken-image fallback, the Smart Placeholder for empty slots, and the srcset the backend ships as image_variants — a raw <img> silently gives up all three.",
          docs: `${context.env.docs}#what-themes-must-not-do`,
        }));
      }

      const match = source.match(/from '(?:@\/)?themes\/(?!.*\/)?([\w-]+)/);
      if (match && match[1] !== context.slug) {
        findings.push(finding(context, 'theme/code-quality', 'reject', {
          where: relative(context.dir, path),
          found: `imports from the "${match[1]}" theme`,
          fix: 'A theme is self-contained. Copy what you need into your own folder, or ask for it to be promoted into @usequeek/theme-kit if every theme needs it.',
          docs: `${context.env.docs}#what-themes-must-not-do`,
        }));
      }
    }

    return findings;
  },
};

export const sdkBoundaryRule: Rule = {
  id: 'theme/core-boundary',
  summary: 'No SDK imports, no direct API calls, no store mutations',
  kind: 'static',
  run(context) {
    const findings: Finding[] = [];

    for (const path of themeSourceFiles(context.dir)) {
      const source = readFileSync(path, 'utf8');
      const where = relative(context.dir, path);

      if (/from '@queekai\/client-sdk'|from '@\/lib\/core\/sdk\//.test(source)) {
        findings.push(finding(context, 'theme/core-boundary', 'reject', {
          where,
          found: 'imports the SDK directly',
          fix: 'Themes are presentation. Go through a core hook (useProducts, useCategories, useCart) — core owns transport, auth and retries.',
          docs: `${context.env.docs}#what-themes-must-not-do`,
        }));
      }

      if (/\b(?:fetch|axios)\s*\(\s*['"`]https?:/.test(source)) {
        findings.push(finding(context, 'theme/core-boundary', 'reject', {
          where,
          found: 'calls a remote endpoint directly',
          fix: 'Use a core hook instead — a direct call misses auth, the 401 refresh, and preview-mode data.',
          docs: `${context.env.docs}#what-themes-must-not-do`,
        }));
      }
    }

    return findings;
  },
};


/**
 * The ThemeModule shape (Layout, Header, Footer, blocks, getBlock, pages…) is
 * enforced by TypeScript, because a theme writes `const theme: ThemeModule`.
 * The one thing the compiler cannot catch is a theme that drops the annotation
 * — then nothing checks the shape at all, and core discovers the missing slot
 * at render time in a vendor's store.
 *
 * Checked by reading the source rather than importing it: index.ts pulls the
 * whole theme graph, which reaches the SDK and will not load outside a bundler.
 */
export const moduleContractRule: Rule = {
  id: 'theme/module-contract',
  summary: 'The theme module is typed as ThemeModule, so its shape is compiler-enforced',
  kind: 'static',
  run(context) {
    const source = context.read('index.ts') ?? context.read('index.tsx');
    if (source === null) {
      return [finding(context, 'theme/module-contract', 'reject', {
        where: `${context.env.root}`,
        found: 'no index.ts or index.tsx',
        fix: 'Export a default ThemeModule from index.ts — it is how core loads your theme.',
        docs: `${context.env.docs}#theme-contract`,
      })];
    }

    const annotated = /:\s*ThemeModule\b/.test(source);
    const exported = /export\s+default\s/.test(source);

    const findings: Finding[] = [];
    if (!exported) {
      findings.push(finding(context, 'theme/module-contract', 'reject', {
        where: `${context.env.root}index.ts`,
        found: 'no default export',
        fix: 'Core loads a theme with `import(...).then(m => m.default)`. Without a default export it cannot render at all.',
        docs: `${context.env.docs}#theme-contract`,
      }));
    }
    if (!annotated) {
      findings.push(finding(context, 'theme/module-contract', 'reject', {
        where: `${context.env.root}index.ts`,
        found: 'the exported module is not annotated `: ThemeModule`',
        fix: 'Write `const theme: ThemeModule = { ... }`. The annotation is what makes the compiler check every required slot — without it a missing page or block surfaces in a live store instead of at build time.',
        docs: `${context.env.docs}#theme-contract`,
      }));
    }

    return findings;
  },
};


/** Mirrors queek_backend `config/category_packs.php` (minus the `_default` fallback). */
const VALID_BUCKETS = ['food', 'supermarket', 'product', 'pharmacy', 'laundry', 'delivery', 'service', 'gas-refill', 'local_market'];
/**
 * Chrome renders once per page, so it is never a composed SECTION and demo
 * completeness cannot apply — its best_for/auto_pick are still validated by
 * theme/selection-metadata.
 *
 * A DENYLIST on purpose. This started as an allowlist of four scopes, which
 * meant every scope a theme invented was exempt by default: `contact` was
 * declared by six of seven themes and verified on none, and `blog` likewise.
 * Inverted, a new scope is covered the day it lands and opting out costs a
 * deliberate line here.
 */
const CHROME_SCOPES = ['header', 'footer', 'subscribe'];

export const selectionMetadataRule: Rule = {
  id: 'theme/selection-metadata',
  summary: 'best_for / auto_pick / min_images are values the backend picker can use',
  kind: 'static',
  run(context) {
    const variants = (context.manifest?.variants ?? {}) as unknown as Record<string, Array<Record<string, unknown>>>;
    const findings: Finding[] = [];

    for (const [scope, list] of Object.entries(variants)) {
      for (const variant of list) {
        const label = `${scope}.${String(variant.id)}`;
        const at = `${context.env.root}manifest.ts`;
        const add = (found: string, fix: string): void => {
          findings.push(finding(context, 'theme/selection-metadata', 'reject', { where: at, found: `${label}: ${found}`, fix, docs: `${context.env.docs}#selection-metadata-best_for--auto_pick--min_images` }));
        };

        const bestFor = variant.best_for as string[] | undefined;
        if (bestFor !== undefined) {
          const invalid = bestFor.filter((bucket) => !VALID_BUCKETS.includes(bucket));
          if (invalid.length > 0) add(`unknown best_for bucket(s) [${invalid.join(', ')}]`, `Use one of: ${VALID_BUCKETS.join(', ')}. An unknown bucket silently never matches, so the variant is never auto-picked.`);
        }
        if (variant.auto_pick !== undefined && typeof variant.auto_pick !== 'boolean') {
          add(`auto_pick is ${typeof variant.auto_pick}`, 'auto_pick must be a boolean.');
        }
        const minImages = variant.min_images;
        if (minImages !== undefined && (typeof minImages !== 'number' || !Number.isInteger(minImages) || minImages < 1)) {
          add(`min_images is ${JSON.stringify(minImages)}`, 'min_images must be a positive integer — it gates the variant on how many real photos a vendor has.');
        }
      }
    }

    return findings;
  },
};

export const demoCompletenessRule: Rule = {
  id: 'theme/demo-completeness',
  summary: 'Every auto-pickable variant is demonstrated in demo.json (and, advisably, in every alternative store)',
  kind: 'static',
  run(context) {
    if (!context.manifest) return [];

    const variants = (context.manifest.variants ?? {}) as unknown as Record<string, Array<Record<string, unknown>>>;
    const findings: Finding[] = [];

    for (const store of context.demos) {
      if (!store.data) continue;
      const pages = (store.data.pages as Record<string, { content?: Array<{ type?: string; variant?: string | null }> }>) ?? {};
      const list = Array.isArray(pages) ? pages : Object.values(pages);
      const demonstrated = new Set<string>();
      for (const page of list) {
        for (const section of page?.content ?? []) {
          if (typeof section?.type === 'string') demonstrated.add(`${section.type}.${section.variant ?? 'default'}`);
        }
      }

      const missing: string[] = [];
      for (const scope of Object.keys(variants).filter((name) => !CHROME_SCOPES.includes(name))) {
        for (const variant of variants[scope] ?? []) {
          if (variant.auto_pick === false) continue;
          const id = String(variant.id);
          if (!demonstrated.has(`${scope}.${id}`)) missing.push(`${scope}.${id}`);
        }
      }
      if (missing.length === 0) continue;

      // The primary is what the capture pipeline thumbnails and what the
      // builder takes variant art from, so a hole there is a hole for every
      // vendor. An alternative store that skips a variant only means the
      // builder falls back to the primary's art for it — worth knowing, not
      // worth blocking.
      const primary = store.id === PRIMARY_DEMO_ID;
      findings.push(finding(context, 'theme/demo-completeness', primary ? 'reject' : 'warn', {
        where: `${context.env.root}${store.file}`,
        found: `auto-pickable variant(s) never shown: ${missing.join(', ')}`,
        fix: primary
          ? 'Add a section using each to demo.json. The demo is what a vendor previews AND what the capture pipeline turns into section-library thumbnails — an undemonstrated variant is one a vendor is offered but has never seen.'
          : `Add a section using each to ${store.file}, so a store built from it gets this store's art for every variant instead of the primary's.`,
        docs: `${context.env.docs}#homepage-requirement-mandatory`,
      }));
    }

    return findings;
  },
};

export const subscribeScopeRule: Rule = {
  id: 'theme/subscribe-scope',
  summary: 'Declares a subscribe scope with exactly one default variant',
  kind: 'static',
  run(context) {
    if (!context.manifest) return [];

    const variants = ((context.manifest.variants ?? {}) as unknown as Record<string, Array<Record<string, unknown>>>).subscribe ?? [];
    const at = `${context.env.root}manifest.ts`;
    const add = (found: string, fix: string): Finding =>
      finding(context, 'theme/subscribe-scope', 'reject', { where: at, found, fix, docs: `${context.env.docs}#manifest` });

    if (variants.length === 0) {
      return [add('no subscribe scope', 'Declare `variants.subscribe`. A theme that omits it silently loses the newsletter app with no error anywhere — the backend falls back to a default variant that does not exist.')];
    }

    const findings: Finding[] = [];
    const defaults = variants.filter((variant) => variant.default === true);
    if (defaults.length !== 1) {
      findings.push(add(`subscribe declares ${defaults.length} default variants`, 'Exactly one must be `default: true` — it is what the backend resolves to when a vendor has not chosen, and on a theme switch.'));
    }

    const ids = variants.map((variant) => String(variant.id));
    if (new Set(ids).size !== ids.length) {
      findings.push(add('duplicate subscribe variant ids', 'Ids must be unique within a scope.'));
    }

    return findings;
  },
};


/**
 * Block types core can actually render — the same list as `BlockType` in
 * @usequeek/theme-kit/types/block, which PageRenderer switches on. Anything else falls
 * to its `default: return null`.
 */
const VALID_BLOCK_TYPES = ["content", "image", "gallery", "video", "table", "button", "embed", "divider", "callout", "quote", "products", "categories", "contact", "reviews", "faq", "product_qa", "blog"];

export const demoBlockTypesRule: Rule = {
  id: 'theme/demo-block-types',
  summary: 'Every section in every demo store is a block type core can render',
  kind: 'static',
  run(context) {
    const findings: Finding[] = [];

    for (const store of context.demos) {
      if (!store.data) continue;
      const pages = (store.data.pages as Record<string, { content?: Array<{ type?: string }> }>) ?? {};
      const list = Array.isArray(pages)
        ? (pages as Array<{ slug?: string; content?: Array<{ type?: string }> }>)
        : Object.entries(pages).map(([slug, page]) => ({ slug, ...page }));

      for (const page of list) {
        for (const section of page?.content ?? []) {
          const type = section?.type;
          if (typeof type !== 'string' || VALID_BLOCK_TYPES.includes(type)) continue;

          findings.push(finding(context, 'theme/demo-block-types', 'reject', {
            where: `${context.env.root}${store.file} → pages.${page.slug ?? '?'}`,
            found: `section type "${type}" is not a block core renders`,
            fix: `PageRenderer returns null for an unknown type, so the section is invisible in the preview AND in every store built from this page — page_compositions publishes the type verbatim. Use one of: ${VALID_BLOCK_TYPES.join(', ')}.`,
            docs: `${context.env.docs}#framework-owned-blocks`,
          }));
        }
      }
    }

    return findings;
  },
};


export const identityRule: Rule = {
  id: 'theme/identity',
  summary: 'manifest, config, demo and directory all agree on the slug',
  kind: 'static',
  run(context) {
    const manifestSlug = (context.manifest as unknown as { slug?: string } | null)?.slug;
    const configSlug = (context.read('theme.config.ts') ?? '').match(/slug:\s*'([a-z0-9-]+)'/)?.[1];
    const layout = context.read('layout.tsx') ?? '';
    const rootClass = layout.match(/className="theme-([a-z0-9-]+)"/)?.[1];

    // Every store claims the theme — a link inside `/roast~foods` is built
    // from the URL, not from profile.slug, so there is no reason for an
    // alternative store to name a different theme and one good reason not
    // to: the API headers the preview sends carry it.
    const stores = context.demos.flatMap((store): Array<[string, string | undefined]> => {
      if (!store.data) return [];
      return [
        [`${store.file} profile.slug`, ((store.data.profile as { slug?: string } | undefined) ?? {}).slug],
        [`${store.file} config.theme`, ((store.data.config as { theme?: string } | undefined) ?? {}).theme],
      ];
    });

    const disagree = ([
      ['layout.tsx root class `theme-…`', rootClass],
      ['manifest.ts slug', manifestSlug],
      ["theme.config.ts slug", configSlug],
      ...stores,
    ] as Array<[string, string | undefined]>)
      .filter(([, value]) => value !== undefined && value !== context.slug);

    if (disagree.length === 0) return [];

    return disagree.map(([where, value]) =>
      finding(context, 'theme/identity', 'reject', {
        where: `${context.env.root}`,
        found: `${where} is "${value}", but the theme directory is "${context.slug}"`,
        fix: `Set it to "${context.slug}". Your whole stylesheet is scoped to \`.theme-${context.slug}\`, the registry keys entries on manifest.slug (and only WARNS on a mismatch, so a disagreement ships two entries claiming one slug), and the backend syncs by slug. These four have to be one name.`,
        docs: `${context.env.docs}#registration`,
      }));
  },
};

export const productMetafieldsRule: Rule = {
  id: 'theme/product-page-places-metafields',
  summary: 'Every product page places the core-owned <ProductMetafields /> section',
  kind: 'static',
  run(context) {
    const source = context.read('pages/product.tsx');
    // No product page (themes/default renders product details through its
    // product modal) — there is nowhere to place the section.
    if (source === null) return [];
    if (/<ProductMetafields[\s>]/.test(stripComments(source))) return [];
    return [finding(context, 'theme/product-page-places-metafields', 'reject', {
      where: `${context.env.root}pages/product.tsx`,
      found: 'product page does not place <ProductMetafields />',
      fix: "Import { ProductMetafields } from '@usequeek/theme-kit/components/product-metafields' and render <ProductMetafields product={product} definitions={metafieldDefinitions} /> below the description. Themes never re-implement metafield rendering.",
      docs: `${context.env.docs}#custom-data-metafields--metaobjects`,
    })];
  },
};


export const poweredByRule: Rule = {
  id: 'theme/footer-shows-powered-by',
  summary: 'Every footer variant renders the core-owned <PoweredByQueek /> attribution',
  kind: 'static',
  run(context) {
    // Footer implementations live in footers/*.tsx; themes without that dir
    // (default, _bare, the starter) render footer.tsx instead. footer.tsx is
    // always checked too — several themes keep a full second implementation
    // there rather than a re-export of one variant.
    const candidates: string[] = [];
    if (context.exists('footers')) {
      let entries: string[];
      try {
        entries = readdirSync(join(context.dir, 'footers'));
      } catch {
        return [];
      }
      for (const entry of entries) {
        if (entry.endsWith('.tsx')) candidates.push(`footers/${entry}`);
      }
    }
    if (context.exists('footer.tsx')) candidates.push('footer.tsx');
    candidates.sort();

    const memo = new Map<string, boolean>();
    const passes = (file: string, trail: string[]): boolean => {
      const hit = memo.get(file);
      if (hit !== undefined) return hit;
      // Import cycle: judged on its own top-level evaluation, not as a failure.
      if (trail.includes(file)) return true;
      const source = context.read(file);
      if (source === null) return true;
      const code = stripComments(source);
      if (/<PoweredByQueek[\s>]/.test(code)) {
        memo.set(file, true);
        return true;
      }
      // A file that renders its own <footer> without the component fails here.
      // Helpers (icon sets) and delegating shims (re-export or forward props
      // to another footer file) pass when every footer file they import passes.
      if (/<footer[\s>]/.test(code)) {
        memo.set(file, false);
        return false;
      }
      const ok = localFooterImports(code, file).every((target) => passes(target, [...trail, file]));
      memo.set(file, ok);
      return ok;
    };

    return candidates.filter((file) => !passes(file, [])).map((file) =>
      finding(context, 'theme/footer-shows-powered-by', 'reject', {
        where: `${context.env.root}${file}`,
        found: 'footer variant does not render <PoweredByQueek />',
        fix: `Import { PoweredByQueek } from '@usequeek/theme-kit/components/powered-by-queek' and render <PoweredByQueek /> in the footer, keeping the theme's own placement and spacing. Style only the core-powered-by classes. Themes never re-implement the attribution markup.`,
        docs: `${context.env.docs}#attribution`,
      }));
  },
};

/** Relative imports that resolve to another footer file (`footer.tsx`, `footers/*`). */
function localFooterImports(code: string, file: string): string[] {
  const base = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.';
  const out: string[] = [];
  for (const match of code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const parts = (base === '.' ? [] : base.split('/')).concat(match[1].split('/'));
    const norm: string[] = [];
    for (const part of parts) {
      if (part === '' || part === '.') continue;
      if (part === '..') norm.pop();
      else norm.push(part);
    }
    let rel = norm.join('/');
    if (!/\.(tsx?|jsx?)$/.test(rel)) rel += '.tsx';
    if (rel === 'footer.tsx' || rel.startsWith('footers/')) out.push(rel);
  }
  return out;
}

/* ── Templates: the registry contract the backend builds a store from ─────
   (queek_backend .agent/TASKS/frontend/storefront-theme-templates-contract.md)
   Every demo store is a template a merchant — or the AI on their behalf — can
   pick. The backend builds from the one picked, so what it publishes has to
   be complete and true. */

/** Every published template, the primary first, with the description it declares. */
function templatesOf(context: ThemeContext): Array<{ id: string; description: string | null; where: string }> {
  const config = `${context.env.root}theme.config.ts`;
  return [
    { id: PRIMARY_DEMO_ID, description: context.defaultDescription, where: `${config} → default_demo.description` },
    ...(context.declaredDemos ?? []).map((demo) => ({ id: demo.id, description: typeof demo.description === 'string' ? demo.description : null, where: `${config} → demos[${demo.id}].description` })),
  ];
}

export const templateDescriptionRule: Rule = {
  id: 'theme/template-description',
  summary: 'Every template carries a description an AI can choose it by (≤ 300 chars)',
  kind: 'static',
  run(context) {
    if (context.retired || context.declaredDemos === null) return [];
    return templatesOf(context).flatMap(({ id, description, where }) => {
      const text = description?.trim() ?? '';
      const placeholder = text.startsWith(TEMPLATE_DESCRIPTION_PLACEHOLDER);
      if (text.length > 0 && text.length <= TEMPLATE_DESCRIPTION_MAX && !placeholder) return [];
      return [finding(context, 'theme/template-description', 'reject', {
        where,
        found: placeholder
          ? `template "${id}" description is still the scaffold's placeholder`
          : text.length === 0 ? `template "${id}" has no description` : `template "${id}" description is ${text.length} chars (max ${TEMPLATE_DESCRIPTION_MAX})`,
        fix: `Write one for a model choosing on a merchant's behalf, at most ${TEMPLATE_DESCRIPTION_MAX} characters: who it fits · the look · the signature sections · what material it needs to look right. The primary's goes in \`default_demo: { description }\`, the others on their \`demos[]\` entry.`,
        docs: `${context.env.docs}#templates`,
      })];
    });
  },
};

export const templateScreenshotRule: Rule = {
  id: 'theme/template-screenshot',
  summary: 'Every template has a 1280×800 screenshot, uploaded to R2',
  kind: 'static',
  run(context) {
    if (context.retired || context.declaredDemos === null) return [];
    const lock = ((): Record<string, string> => {
      try { return JSON.parse(context.read(SCREENSHOT_LOCK) ?? '{}') as Record<string, string>; } catch { return {}; }
    })();
    return templatesOf(context).flatMap(({ id }) => {
      const file = screenshotFile(id, context.exists);
      const where = `${context.env.root}${file}`;
      if (!context.exists(file)) {
        return [finding(context, 'theme/template-screenshot', 'reject', {
          where,
          found: `template "${id}" has no screenshot`,
          fix: `Capture the template's first screen at 1280×800 (${context.env.preview(id)}) and save it here. The AI looks at this image before committing to a template — a missing one means a blind pick.`,
          docs: `${context.env.docs}#templates`,
        })];
      }
      // Uploading it is Queek's side of submission; locally the file existing is the contract.
      if (!context.env.submission) return [];
      const url = screenshotUrl(context.slug, readFileSync(context.file(file)), file);
      if (lock[file] === url) return [];
      return [finding(context, 'theme/template-screenshot', 'reject', {
        where,
        found: lock[file] ? 'screenshot changed since it was uploaded — the registry would publish a URL that does not exist yet' : 'screenshot has never been uploaded to R2',
        fix: `Run \`yarn theme:rehost-images --theme ${context.slug}\` (or \`yarn theme:check ${context.slug} --fix\`) and commit ${SCREENSHOT_LOCK}. The registry publishes the screenshot as an absolute media.usequeek.com URL derived from its bytes.`,
        fixable: true,
        docs: `${context.env.docs}#templates`,
      })];
    });
  },
};

export const templateChromeRule: Rule = {
  id: 'theme/template-chrome',
  summary: "A template's header and footer are variants the theme implements",
  kind: 'static',
  run(context) {
    if (context.retired || !context.manifest) return [];
    const variants = (context.manifest.variants ?? {}) as unknown as Record<string, Array<{ id: string }>>;
    const findings: Finding[] = [];
    for (const store of context.demos) {
      const config = (store.data?.config ?? {}) as Record<string, { variant?: unknown } | undefined>;
      for (const scope of ['header', 'footer'] as const) {
        const ids = (variants[scope] ?? []).map((variant) => variant.id);
        const named = config[scope]?.variant;
        // A theme with no variants of the scope (the single-page default) has
        // no chrome to choose; the registry publishes null for it.
        if (ids.length === 0 || typeof named !== 'string' || ids.includes(named)) continue;
        findings.push(finding(context, 'theme/template-chrome', 'reject', {
          where: `${context.env.root}${store.file} → config.${scope}.variant`,
          found: `template "${store.id}" names ${scope} "${named}", which the theme does not implement (${ids.join(', ')})`,
          fix: `Use one of ${ids.join(', ')}. The backend applies a template's ${scope} to the store built from it; an unimplemented one would publish as null and the store would not match its preview.`,
          docs: `${context.env.docs}#templates`,
        }));
      }
    }
    return findings;
  },
};

/** Keys the renderer supplies, never a variant's own field. */
const FRAMEWORK_KEYS = new Set(['bg_color', 'bg_image', 'bg_overlay', 'anchor_id']);

export const templateStyleRule: Rule = {
  id: 'theme/template-style',
  summary: "A section's style keys are fields its variant declares",
  kind: 'static',
  run(context) {
    if (context.retired || !context.manifest) return [];
    const variants = (context.manifest.variants ?? {}) as unknown as Record<string, Array<{ id: string; fields?: Record<string, unknown> }>>;
    // The theme's style vocabulary: every presentational field any of its
    // variants declares. A section setting one its own variant does not
    // declare is style the backend would copy onto a section that ignores it.
    const vocabulary = new Set<string>();
    for (const list of Object.values(variants)) {
      for (const variant of list ?? []) {
        for (const [name, spec] of Object.entries(variant.fields ?? {})) if (isPresentationalField(name, spec)) vocabulary.add(name);
      }
    }
    const findings: Finding[] = [];
    for (const store of context.demos) {
      type Page = { content?: Array<{ type?: string; variant?: string | null; data?: Record<string, unknown> }> };
      const pages = store.data?.pages;
      const pageList: Array<[string, Page]> = Array.isArray(pages)
        ? (pages as Page[]).map((page, i) => [String(i), page])
        : Object.entries((pages ?? {}) as Record<string, Page>);
      for (const [pageKey, page] of pageList) {
        (page?.content ?? []).forEach((section, index) => {
          if (typeof section?.type !== 'string' || !section.data || typeof section.data !== 'object') return;
          const declared = variants[section.type]?.find((variant) => variant.id === (section.variant ?? 'default'));
          if (!declared) return; // framework-owned block or a variant other rules report
          const fields = declared.fields ?? {};
          const strays = Object.keys(section.data).filter((key) => vocabulary.has(key) && !FRAMEWORK_KEYS.has(key) && !(key in fields));
          if (strays.length === 0) return;
          findings.push(finding(context, 'theme/template-style', 'reject', {
            where: `${context.env.root}${store.file} → pages.${pageKey}.content[${index}] (${section.type}.${section.variant ?? 'default'})`,
            found: `sets ${strays.join(', ')}, which ${section.type}.${section.variant ?? 'default'} does not declare`,
            fix: 'Remove the key, or declare the field on the variant and make its component read it. A template\'s style is copied onto every store built from it; a key the variant ignores changes nothing and misleads whoever reads the registry.',
            docs: `${context.env.docs}#templates`,
          }));
        });
      }
    }
    return findings;
  },
};

/* ── Round 2 (queek_backend contract R2.1–R2.3, 24/9/26) ───────────────── */

type TemplatePage = { content?: Array<{ type?: string; variant?: string | null }> };

function pagesOf(store: DemoStore): Record<string, TemplatePage> {
  const pages = store.data?.pages;
  return pages && typeof pages === 'object' && !Array.isArray(pages) ? (pages as Record<string, TemplatePage>) : {};
}

export const templateBusinessRule: Rule = {
  id: 'theme/template-business',
  summary: "Every template names its own business in the platform's vocabulary",
  kind: 'static',
  run(context) {
    if (context.retired || context.declaredDemos === null) return [];
    const config = `${context.env.root}theme.config.ts`;
    const templates: Array<{ id: string; keys: unknown; where: string }> = [
      { id: PRIMARY_DEMO_ID, keys: context.defaultFor, where: `${config} → default_demo.for` },
      ...context.declaredDemos.map((demo) => ({ id: demo.id, keys: demo.for, where: `${config} → demos[${demo.id}].for` })),
    ];
    const findings: Finding[] = [];
    for (const { id, keys, where } of templates) {
      if (!Array.isArray(keys) || keys.length === 0) {
        // demos[] without one is already rejected by theme/demo-stores.
        if (id !== PRIMARY_DEMO_ID) continue;
        findings.push(finding(context, 'theme/template-business', 'reject', {
          where,
          found: 'the primary template names no business',
          fix: "Add `for` to `default_demo`, naming the business demo.json is dressed as (medley's beauty store: makeup, skincare, fragrance, beauty-personal-care, beauty-cosmetics). Without it the primary claimed every business the theme serves, so a food vendor was offered a beauty store.",
          docs: `${context.env.docs}#templates`,
        }));
        continue;
      }
      const unknown = keys.filter((key) => typeof key !== 'string' || !isBusinessKey(key));
      if (unknown.length === 0) continue;
      findings.push(finding(context, 'theme/template-business', 'reject', {
        where,
        found: `template "${id}" is for ${unknown.map((key) => JSON.stringify(key)).join(', ')}, not in the business vocabulary`,
        fix: `Use service slugs or catalogue keys from ${context.env.vocabulary} (${BUSINESS_KEYS.size} keys), most specific first. The backend matches vendors on these keys only; any other key matches no one.`,
        docs: `${context.env.docs}#templates`,
      }));
    }
    return findings;
  },
};

/** `food-2` → `food`; null for an id that is not a numbered version. */
function versionBase(id: string): string | null {
  const match = /^(.+)-([2-9])$/.exec(id);
  return match ? match[1] : null;
}

export const templateVersionsRule: Rule = {
  id: 'theme/template-versions',
  summary: 'Every template has its own home design, and a version serves its original\'s business',
  kind: 'static',
  run(context) {
    if (context.retired) return [];
    const findings: Finding[] = [];
    const sequence = (store: DemoStore): string =>
      (pagesOf(store).home?.content ?? []).map((section) => `${section?.type}/${section?.variant ?? 'default'}`).join(' → ');

    const seen = new Map<string, string>();
    // The single-page default theme draws one fixed layout whatever its home
    // lists, so its templates differ by business, not composition.
    for (const store of context.pageBased ? context.demos : []) {
      const home = sequence(store);
      if (!home) continue;
      const first = seen.get(home);
      if (first) {
        findings.push(finding(context, 'theme/template-versions', 'reject', {
          where: `${context.env.root}${store.file} → pages.home`,
          found: `template "${store.id}" has the same home sections, in the same order, as "${first}"`,
          fix: 'A template must be its own design, not a recolour: change the order and the section variants (and the header, footer and palette where the theme allows). Vendors are spread across versions; two identical ones make that a coin toss between the same page.',
          docs: `${context.env.docs}#templates`,
        }));
      } else {
        seen.set(home, store.id);
      }
    }

    const declared = context.declaredDemos ?? [];
    const forOf = new Map(declared.map((demo) => [demo.id, JSON.stringify(demo.for ?? [])]));
    for (const demo of declared) {
      const base = versionBase(demo.id);
      if (!base || !forOf.has(base) || forOf.get(base) === forOf.get(demo.id)) continue;
      findings.push(finding(context, 'theme/template-versions', 'reject', {
        where: `${context.env.root}theme.config.ts → demos[${demo.id}].for`,
        found: `version "${demo.id}" is for ${forOf.get(demo.id)}, "${base}" for ${forOf.get(base)}`,
        fix: `Give "${demo.id}" exactly the \`for\` of "${base}". Versions are the same business in different designs; the backend spreads matching vendors across them.`,
        docs: `${context.env.docs}#templates`,
      }));
    }
    return findings;
  },
};

/** The designed pages every template ships (contract R2.3); versions `-2`… count. */
export const TEMPLATE_PAGES = ['about', 'sales', 'landing'] as const;

export const templatePagesRule: Rule = {
  id: 'theme/template-pages',
  summary: 'Every template ships about, sales and landing pages; sales and landing sell products',
  kind: 'static',
  run(context) {
    // The single-page default theme renders one page whatever the URL.
    if (context.retired || !context.pageBased) return [];
    const findings: Finding[] = [];
    for (const store of context.demos) {
      const pages = pagesOf(store);
      const where = `${context.env.root}${store.file} → pages`;
      for (const slug of TEMPLATE_PAGES) {
        if (Object.keys(pages).some((key) => key === slug || versionBase(key) === slug)) continue;
        findings.push(finding(context, 'theme/template-pages', 'reject', {
          where,
          found: `template "${store.id}" has no \`${slug}\` page`,
          fix: slug === 'about'
            ? 'Ship an `about` page whose every section a vendor can fill from real facts or photos (founder story, team, values, timeline, press). Qee clones it for the vendor.'
            : `Ship a \`${slug}\` page designed for 1–3 products: a products section near the top (a spotlight/featured section takes one product each, a list takes them all), the first hero dressed with their photos, closing on a contact card. Qee clones it and binds the merchant's products.`,
          docs: `${context.env.docs}#templates`,
        }));
      }
      for (const [key, page] of Object.entries(pages)) {
        const kind = TEMPLATE_PAGES.find((slug) => slug !== 'about' && (key === slug || versionBase(key) === slug));
        if (!kind) continue;
        const content = page?.content ?? [];
        const first = content.findIndex((section) => section?.type === 'products');
        if (first === -1) {
          findings.push(finding(context, 'theme/template-pages', 'reject', {
            where: `${context.env.root}${store.file} → pages.${key}`,
            found: `the ${kind} page has no products section`,
            fix: `The backend binds the merchant's named products to every products section on a ${kind} page; with none, the page sells nothing. Put one near the top.`,
            docs: `${context.env.docs}#templates`,
          }));
          continue;
        }
        if (first > 2) {
          findings.push(finding(context, 'theme/template-pages', 'warn', {
            where: `${context.env.root}${store.file} → pages.${key}.content[${first}]`,
            found: `the ${kind} page's first products section is section ${first + 1}`,
            fix: 'Move a products section into the first three, so the product is on the first screen.',
            docs: `${context.env.docs}#templates`,
          }));
        }
        if (content.at(-1)?.type !== 'contact') {
          findings.push(finding(context, 'theme/template-pages', 'warn', {
            where: `${context.env.root}${store.file} → pages.${key}`,
            found: `the ${kind} page does not close on a contact section`,
            fix: 'End it on a contact card: a buyer who is not ready to order needs a way to ask.',
            docs: `${context.env.docs}#templates`,
          }));
        }
      }
    }
    return findings;
  },
};

/* ── Round 2.6: copy a real store can publish unchanged ───────────────── */

/** Every string in a section's copy, with where it sits (`items[2].text`). */
function copyStrings(value: unknown, path = ''): Array<[string, string]> {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) return value.flatMap((entry, i) => copyStrings(entry, `${path}[${i}]`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, entry]) => copyStrings(entry, path ? `${path}.${key}` : key));
  return [];
}

export const templateCopyRule: Rule = {
  id: 'theme/template-copy',
  summary: 'Template copy is true of any store in its business: no store name, place, naira amount, promise or founding date',
  kind: 'static',
  run(context) {
    if (context.retired || !context.manifest) return [];
    const declared = declaredFieldsByVariant(context.manifest.variants);
    const findings: Finding[] = [];
    for (const store of context.demos) {
      const name = (store.data?.profile as { name?: unknown } | undefined)?.name;
      for (const [pageKey, page] of Object.entries(pagesOf(store))) {
        (page?.content ?? []).forEach((section, index) => {
          if (typeof section?.type !== 'string') return;
          const variant = section.variant ?? 'default';
          if (isTestimonialSection(section.type, variant, declared[section.type]?.[variant])) return;
          const lines = copyStrings(sectionCopy(section, declared) ?? {}).flatMap(([path, text]) => {
            const why = copyViolations(text, typeof name === 'string' ? name : null);
            return why.length > 0 ? [`${path}: ${why.join('; ')} — "${text.length > 80 ? `${text.slice(0, 77)}…` : text}"`] : [];
          });
          if (lines.length === 0) return;
          findings.push(finding(context, 'theme/template-copy', 'reject', {
            where: `${context.env.root}${store.file} → pages.${pageKey}.content[${index}] (${section.type}.${variant})`,
            found: lines.join('\n'),
            fix: 'The setup wizard publishes this copy onto real stores unchanged. Write it for any store in the business: the store\'s name becomes a role ("our kitchen", "the studio"), a place becomes generic ("across the city") or goes, and prices, delivery windows, guarantees and founding dates go — they are the vendor’s to state. Testimonials and reviews are exempt.',
            docs: `${context.env.docs}#templates`,
          }));
        });
      }
    }
    return findings;
  },
};

export const STATIC_RULES: Rule[] = [moduleContractRule, structureRule, demoStoreRule, demoStoresRule, demoArtRule, codeQualityRule, sdkBoundaryRule, selectionMetadataRule, demoCompletenessRule, subscribeScopeRule, demoBlockTypesRule, identityRule, productMetafieldsRule, poweredByRule,
  templateDescriptionRule, templateScreenshotRule, templateChromeRule, templateStyleRule,
  templateBusinessRule, templateVersionsRule, templatePagesRule, templateCopyRule,
];
