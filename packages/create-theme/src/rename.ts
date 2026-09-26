import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

export interface Identity {
  slug: string;
  prefix: string;
  name: string;
}

/** The skeleton's identity, as the starter ships it. */
export const SKELETON: Identity = { slug: 'bare', prefix: 'bare', name: 'Bare' };

const TEXT = new Set(['.ts', '.tsx', '.css', '.json', '.md', '.mdx']);
const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A URL (`https?://…` up to whitespace or a quote) names a hosted thing, not
 * the copy: the source theme's art lives under its own folder until it is
 * rehosted, so URLs stay out of every pass below.
 */
const URL = /(https?:\/\/[^\s'"`<>]*)/g;

/** `Sole Theory` → `SoleTheory`: the display name as the head of a component identifier. */
function pascalCase(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join('');
}

/** The display name as a literal of the file it is written into. */
function literal(ext: string, text: string): string {
  if (ext === '.json') return JSON.stringify(text).slice(1, -1);
  if (ext === '.ts' || ext === '.tsx') {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
      .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
  }
  return text;
}

/**
 * Rename one file's identity as TOKENS: the root class (`theme-bare`), the demo
 * ids (`demo-bare`, `demo-bare-home`), every class token (`bare-main
 * bare-product` — both), the display name (`Bare`) and the slug (`bare`). A
 * real theme adds more shapes of the same identity: CSS custom properties
 * (`--md-accent`), data attributes (`data-md-open`), component heads
 * (`MedleyModalLayer`), store ids (`medley-food`) and preview paths
 * (`/medley~food`, via the slug token — `~` is a token edge). The skeleton
 * keeps the English word "bare" out of its copy so every remaining standalone
 * token is identity.
 *
 * The display name and the slug go in ONE pass (an alternation), so a name that
 * holds the old slug as a word ("simply bare") is never rewritten by the slug
 * pass. Nothing the earlier passes write can match it: the slug they write
 * follows a `-` and a class prefix is followed by one, and a token has a `-` on
 * neither side — a store id (`<slug>-<id>`) keeps that shape, and a component
 * head is only ever followed by an uppercase letter, which the token pass
 * never spans.
 */
export function renameContent(content: string, ext: string, from: Identity, to: Identity): string {
  const nameOrSlug = new RegExp(`(?<![\\w-])(?:(${escape(from.name)})|${escape(from.slug)})(?![\\w-])`, 'g');
  const rootClass = new RegExp(`(?<![\\w-])theme-${escape(from.slug)}(?![\\w-])`, 'g');
  const demoId = new RegExp(`(?<![\\w-])demo-${escape(from.slug)}(?![\\w])`, 'g');
  const storeId = new RegExp(`(?<![\\w-])${escape(from.slug)}-(?=[\\w$])`, 'g');
  const cssVar = new RegExp(`--${escape(from.prefix)}-`, 'g');
  const dataAttr = new RegExp(`data-${escape(from.prefix)}-`, 'g');
  const classToken = new RegExp(`(?<![\\w-])${escape(from.prefix)}-(?=[\\w$])`, 'g');
  const fromPascal = pascalCase(from.name);
  const toPascal = pascalCase(to.name);
  const componentHead =
    fromPascal.length > 0 && toPascal.length > 0 && fromPascal !== toPascal
      ? new RegExp(`(?<![\\w$])${escape(fromPascal)}(?=[A-Z])`, 'g')
      : null;

  const renameSegment = (segment: string): string => {
    let out = segment
      .replace(rootClass, () => `theme-${to.slug}`)
      .replace(demoId, () => `demo-${to.slug}`)
      .replace(cssVar, () => `--${to.prefix}-`)
      .replace(dataAttr, () => `data-${to.prefix}-`)
      // The class prefix keeps its old priority: where slug and prefix spell the
      // same token (the skeleton's `bare-`), the prefix wins, as before.
      .replace(classToken, () => `${to.prefix}-`)
      .replace(storeId, () => `${to.slug}-`);
    if (componentHead) out = out.replace(componentHead, () => toPascal);
    return out.replace(nameOrSlug, (_match, name: string | undefined) => (name !== undefined ? literal(ext, to.name) : to.slug));
  };

  // Odd indexes are the URLs themselves (split keeps the capture); they pass through verbatim.
  return content
    .split(URL)
    .map((part, index) => (index % 2 === 1 ? part : renameSegment(part)))
    .join('');
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' ? [] : walk(path);
    return TEXT.has(extname(name)) ? [path] : [];
  });
}

/** Rename every text file of a theme folder in place. */
export function renameTheme(themeDir: string, from: Identity, to: Identity): void {
  for (const path of walk(themeDir)) {
    const before = readFileSync(path, 'utf8');
    const after = renameContent(before, extname(path), from, to);
    if (after !== before) writeFileSync(path, after);
  }
}
