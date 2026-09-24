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
const token = (text: string): RegExp => new RegExp(`(?<![\\w-])${escape(text)}(?![\\w-])`, 'g');

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
 * bare-product` — both), the display name (`Bare`) and the slug (`bare`). The
 * skeleton keeps the English word "bare" out of its copy so every remaining
 * standalone token is identity.
 */
export function renameContent(content: string, ext: string, from: Identity, to: Identity): string {
  return content
    .replace(new RegExp(`(?<![\\w-])theme-${escape(from.slug)}(?![\\w-])`, 'g'), () => `theme-${to.slug}`)
    .replace(new RegExp(`(?<![\\w-])demo-${escape(from.slug)}(?![\\w])`, 'g'), () => `demo-${to.slug}`)
    .replace(new RegExp(`(?<![\\w-])${escape(from.prefix)}-(?=[\\w$])`, 'g'), () => `${to.prefix}-`)
    .replace(token(from.name), () => literal(ext, to.name))
    .replace(token(from.slug), () => to.slug);
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
