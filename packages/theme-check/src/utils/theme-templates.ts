/**
 * Theme templates — the registry contract the backend builds from
 * (queek_backend `.agent/TASKS/frontend/storefront-theme-templates-contract.md`).
 *
 * A template is a demo store: `demo.json` (id `default`) or `demos/<id>.json`.
 * The backend builds a vendor's store from ONE template's layout, keeps its
 * declared variants, applies its chrome, dials and per-section `style`, and
 * fills every content slot with the vendor's own material. Everything here is
 * the shared reading of that contract — the registry generator, the registry
 * API route, the rehost script, theme-check and the tests all call it, so the
 * five of them cannot disagree about what a template publishes.
 */

import { createHash } from 'node:crypto';
import { PRIMARY_DEMO_ID } from './theme-demos.js';

/** Longest `description` a template may carry — written for a model choosing on a merchant's behalf. */
export const TEMPLATE_DESCRIPTION_MAX = 300;
/** How `themes/_bare`'s description starts — a new theme must replace it before it publishes. */
export const TEMPLATE_DESCRIPTION_PLACEHOLDER = 'Replace before publishing.';

/** Where rehosted theme imagery is served — the host the backend passes through untouched. */
export const THEME_ASSET_BASE = 'https://media.usequeek.com/theme-assets';

/** Per-theme record of the screenshots the rehost script has uploaded. */
export const SCREENSHOT_LOCK = 'screenshots.json';

/* ── screenshots ─────────────────────────────────────────────────────── */

/**
 * The screenshot file a template is judged by, relative to the theme dir:
 * `theme.jpg` (or `theme.png`) for the primary, `demos/<id>.jpg` for the rest.
 * `exists` decides between jpg and png for the primary, so callers pass their
 * own file check (fs, or theme-check's context).
 */
export function screenshotFile(demoId: string, exists: (relative: string) => boolean): string {
  if (demoId !== PRIMARY_DEMO_ID) return `demos/${demoId}.jpg`;
  return exists('theme.jpg') || !exists('theme.png') ? 'theme.jpg' : 'theme.png';
}

/**
 * Content-addressed, like the section art: `theme-assets/{theme}/{sha256[..16]}.{ext}`.
 * A re-captured screenshot gets a new URL, so no cache anywhere keeps showing
 * the old picture — and the URL is known from the bytes alone, offline.
 */
export function screenshotKey(theme: string, bytes: Uint8Array, file: string): string {
  const extension = file.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
  return `theme-assets/${theme}/${createHash('sha256').update(bytes).digest('hex').slice(0, 16)}.${extension}`;
}

export function screenshotUrl(theme: string, bytes: Uint8Array, file: string): string {
  return `${THEME_ASSET_BASE}/${screenshotKey(theme, bytes, file).slice('theme-assets/'.length)}`;
}

/* ── tokens ──────────────────────────────────────────────────────────── */

export interface TokenReach {
  /** The theme's CSS reads the kit's colour vars (`--brand-bg`, `--brand-accent`, …). */
  colors: boolean;
  /** The theme's CSS reads the kit's face vars (`--font-heading` / `--font-body`). */
  fonts: boolean;
}

const COLOR_VAR = /var\(\s*--brand-(?:bg|text|text-muted|primary|accent|accent-soft|on-accent|surface|surface-muted|border|button-bg|button-text)\b/;
const FONT_VAR = /var\(\s*--font-(?:heading|body)\b/;

/**
 * Which token groups a theme actually renders from. A theme that hard-codes
 * its palette (roast, glow, carat) publishes tokens without `color`, so the
 * backend never promises a merchant a colour change the theme will ignore.
 * Comments are stripped first — glow mentions `--brand-text` only in one.
 */
export function tokenReach(css: string): TokenReach {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return { colors: COLOR_VAR.test(code), fonts: FONT_VAR.test(code) };
}

/**
 * A template's tokens as the backend should apply them: the dials always
 * (sizes, weights, spacing, radius, motion, image treatment), the palette and
 * the faces only when the theme reads them. Undefined when nothing is left.
 */
export function templateTokens(tokens: unknown, reach: TokenReach): Record<string, unknown> | undefined {
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) return undefined;
  const out: Record<string, unknown> = JSON.parse(JSON.stringify(tokens));
  if (!reach.colors) delete out.color;
  if (!reach.fonts && out.type && typeof out.type === 'object') {
    const type = out.type as Record<string, unknown>;
    delete type.heading_font;
    delete type.body_font;
    if (Object.keys(type).length === 0) delete out.type;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/* ── chrome ──────────────────────────────────────────────────────────── */

/**
 * The header (or footer) variant a template names, when the theme implements
 * one of that scope. A theme with no variants of the scope (the single-page
 * default theme) publishes null; a name the theme does not implement also
 * publishes null here and is a theme-check rejection, never a silent fallback.
 */
export function templateChrome(demo: unknown, scope: 'header' | 'footer', implemented: string[]): string | null {
  const config = (demo as { config?: Record<string, { variant?: unknown }> } | null)?.config;
  const variant = config?.[scope]?.variant;
  return typeof variant === 'string' && implemented.includes(variant) ? variant : null;
}

/* ── per-section style ───────────────────────────────────────────────── */

/**
 * Query fields decide WHICH content fills a section, not how it looks; they
 * are enums in several manifests (`sort: latest|popular|…`) but are never
 * style. The vendor's own content drives them.
 */
const QUERY_FIELDS = new Set(['sort', 'collection', 'category', 'ids', 'limit', 'parent', 'tabs', 'trigger']);

const ENUM_DESCRIPTOR = /^\s*[a-z0-9_-]+(?:\s*\|\s*[a-z0-9_-]+)+(?=\s|$|\(|,|—)/i;
const BOOL_DESCRIPTOR = /^\s*bool(?:ean)?\b/i;

/**
 * Whether a declared field is presentational — how the section looks, not
 * what it says: a structured `enum` / `boolean` / `color` field, or a string
 * descriptor that is an `a|b|c` enum or a `bool`. Copy, images, ids and links
 * never qualify; neither do the query fields.
 */
export function isPresentationalField(name: string, spec: unknown): boolean {
  if (QUERY_FIELDS.has(name)) return false;
  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    const type = (spec as { type?: unknown }).type;
    return type === 'enum' || type === 'boolean' || type === 'color';
  }
  if (typeof spec === 'string') return ENUM_DESCRIPTOR.test(spec) || BOOL_DESCRIPTOR.test(spec);
  return false;
}

/** The presentational field names a variant declares. */
export function presentationalFields(fields: Record<string, unknown> | undefined): string[] {
  return Object.entries(fields ?? {}).filter(([name, spec]) => isPresentationalField(name, spec)).map(([name]) => name);
}

interface VariantDeclaration { id: string; fields?: Record<string, unknown> }

/** `{type: {variantId: fields}}` from a manifest's (or registry entry's) `variants`. */
export function declaredFieldsByVariant(variants: unknown): Record<string, Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, Record<string, unknown>>> = {};
  if (!variants || typeof variants !== 'object') return out;
  for (const [scope, list] of Object.entries(variants as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    out[scope] = Object.fromEntries(
      (list as VariantDeclaration[]).filter((v) => v && typeof v.id === 'string').map((v) => [v.id, v.fields ?? {}]),
    );
  }
  return out;
}

/**
 * A section's `style`: the presentational fields its variant declares, with
 * the values the template set. Only primitives — never copy, images, ids or
 * links, which the vendor's content fills. Undefined when there are none.
 */
export function sectionStyle(
  section: { type?: unknown; variant?: unknown; data?: unknown },
  declared: Record<string, Record<string, Record<string, unknown>>>,
): Record<string, string | number | boolean> | undefined {
  if (typeof section.type !== 'string') return undefined;
  const fields = declared[section.type]?.[typeof section.variant === 'string' ? section.variant : 'default'];
  const data = section.data;
  if (!fields || !data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const style: Record<string, string | number | boolean> = {};
  for (const name of presentationalFields(fields)) {
    const value = (data as Record<string, unknown>)[name];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') style[name] = value;
  }
  return Object.keys(style).length > 0 ? style : undefined;
}

/* ── per-section copy (contract R2.4) ──────────────────────────────────── */

/** Field types whose value is words a vendor could keep or rewrite. */
const TEXT_TYPES = new Set(['string', 'text', 'markdown']);
/** A string descriptor that declares words: `string`, `markdown string`, `text — …`, `string[]`. */
const TEXT_DESCRIPTOR = /^\s*(?:markdown\s+)?(?:string|text|markdown)(\[\])?(?=\s|$|\(|,|—)/i;
/** `[{url,title,subtitle,…}]` inside a descriptor: a list of entries and their keys. */
const ENTRY_KEYS = /\[\{([^}\]]+)\}\]/;
/**
 * Keys of a list entry that carry words. Everything else in an entry — url,
 * link, cta_url, alt (it describes that one photo), product_ids, price,
 * hotspot coordinates, icons — belongs to the demo store, not the design.
 */
const ENTRY_TEXT_KEYS = new Set(['title', 'subtitle', 'caption', 'text', 'heading', 'eyebrow', 'label', 'cta_label', 'question', 'answer', 'quote', 'author', 'name', 'role', 'body', 'description', 'content', 'kicker']);
/**
 * Links, references, prices, media, alt text (it describes one photo) and icon
 * names are never copy, whatever their declared type. Nor are the demo store's
 * own facts — its email, phone, address, opening hours and coupon code — or
 * hotspot coordinates (`spots`): the vendor's profile supplies the facts.
 */
const NOT_COPY = /(^|_)(url|link|href|slug|id|ids|price|amount|currency|video|image|icon|alt|email|phone|whatsapp|address|hours|code|spots)$/;
/** `[the balm](/products/balm)` → `the balm`: copy keeps a link's words, never where it pointed. */
const MARKDOWN_LINK = /\[([^\]]*)\]\([^)]*\)/g;

type Copy = Record<string, unknown>;

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.replace(MARKDOWN_LINK, '$1') : undefined;
}

function textsOf(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === 'string') ? value.map((v) => textOf(v) ?? v) : undefined;
}

function entriesCopy(value: unknown, keep: (key: string) => boolean): Copy[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return {};
    return Object.fromEntries(Object.entries(entry as Record<string, unknown>).flatMap(([key, v]) => {
      const text = keep(key) ? textOf(v) : undefined;
      return text ? [[key, text]] : [];
    }));
  });
  return entries.some((entry) => Object.keys(entry).length > 0) ? entries : undefined;
}

/** One declared field's copy from the demo value, or undefined when it holds none. */
function fieldCopy(name: string, spec: unknown, value: unknown): unknown {
  if (NOT_COPY.test(name) || isPresentationalField(name, spec) || QUERY_FIELDS.has(name)) return undefined;

  if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
    const { type, of } = spec as { type?: unknown; of?: Record<string, unknown> };
    if (typeof type === 'string' && TEXT_TYPES.has(type)) return textOf(value);
    if (type === 'string[]') return textsOf(value);
    if (type === 'object[]' && of) {
      return entriesCopy(value, (key) => {
        const sub = of[key] as { type?: unknown } | undefined;
        return !!sub && typeof sub.type === 'string' && TEXT_TYPES.has(sub.type) && !NOT_COPY.test(key) && !isPresentationalField(key, sub);
      });
    }
    return undefined;
  }

  if (typeof spec !== 'string') return undefined;
  const entryKeys = ENTRY_KEYS.exec(spec);
  if (entryKeys) {
    const declared = new Set(entryKeys[1].split(',').map((key) => key.trim()));
    return entriesCopy(value, (key) => declared.has(key) && ENTRY_TEXT_KEYS.has(key));
  }
  const text = TEXT_DESCRIPTOR.exec(spec);
  if (!text) return undefined;
  if (text[1]) return textsOf(value);
  return textOf(value);
}

/**
 * A section's `copy`: the words the template set in the fields its variant
 * declares as text — headings, body, markdown, button labels, and the text
 * keys of its list entries (steps, slides, FAQ items). Never images, links,
 * ids, prices or product and collection references. The backend builds a
 * section with no vendor facts behind it (a how-to, a statement) from this,
 * and qee rewrites it for the vendor. Undefined when there are none.
 */
export function sectionCopy(
  section: { type?: unknown; variant?: unknown; data?: unknown },
  declared: Record<string, Record<string, Record<string, unknown>>>,
): Copy | undefined {
  if (typeof section.type !== 'string') return undefined;
  const fields = declared[section.type]?.[typeof section.variant === 'string' ? section.variant : 'default'];
  const data = section.data;
  if (!fields || !data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const copy: Copy = {};
  for (const [name, spec] of Object.entries(fields)) {
    const value = fieldCopy(name, spec, (data as Record<string, unknown>)[name]);
    if (value !== undefined) copy[name] = value;
  }
  return Object.keys(copy).length > 0 ? copy : undefined;
}
