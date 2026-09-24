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
 *
 * The display name and the slug go in ONE pass (an alternation), so a name that
 * holds the old slug as a word ("simply bare") is never rewritten by the slug
 * pass. Nothing the earlier passes write can match it: the slug they write
 * follows a `-` and a class prefix is followed by one, and a token has a `-` on
 * neither side.
 */
export function renameContent(content: string, ext: string, from: Identity, to: Identity): string {
  const nameOrSlug = new RegExp(`(?<![\\w-])(?:(${escape(from.name)})|${escape(from.slug)})(?![\\w-])`, 'g');
  return content
    .replace(new RegExp(`(?<![\\w-])theme-${escape(from.slug)}(?![\\w-])`, 'g'), () => `theme-${to.slug}`)
    .replace(new RegExp(`(?<![\\w-])demo-${escape(from.slug)}(?![\\w])`, 'g'), () => `demo-${to.slug}`)
    .replace(new RegExp(`(?<![\\w-])${escape(from.prefix)}-(?=[\\w$])`, 'g'), () => `${to.prefix}-`)
    .replace(nameOrSlug, (_match, name: string | undefined) => (name !== undefined ? literal(ext, to.name) : to.slug));
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
