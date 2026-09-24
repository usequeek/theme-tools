import { RESERVED_PREFIXES, RESERVED_SLUGS, categoryOf, labelOf } from './lists.js';

/** `Mọ́ Laundry & Co.` → `mo-laundry-co`: what `yarn theme:pull` accepts, `^[a-z][a-z0-9-]{1,30}$`. */
export function slugify(name: string): string {
  let slug = name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (/^[0-9]/.test(slug)) slug = `t-${slug}`;
  return slug.slice(0, 31).replace(/-+$/, '');
}

/** Why a slug cannot be used, or null. */
export function slugProblem(slug: string): string | null {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(slug)) return `"${slug}" must be 2 to 31 characters: lower-case letters, digits and hyphens, starting with a letter.`;
  if (RESERVED_SLUGS.includes(slug)) return `"${slug}" is one of Queek's own themes. Choose another name.`;
  return null;
}

/** The CSS class prefix: the slug's initials, 2–4 characters, never a Queek theme's own. */
export function prefixFor(slug: string): string {
  const words = slug.split('-').filter(Boolean);
  const initials = words.map((word) => word[0]).join('');
  const candidates = [initials.slice(0, 3), initials.slice(0, 2), slug.replace(/-/g, '').slice(0, 2), slug.replace(/-/g, '').slice(0, 3)];
  for (const letter of 'abcdefghijklmnopqrstuvwxyz') candidates.push(`${slug[0]}${letter}`);
  return candidates.find((prefix) => /^[a-z][a-z0-9]{1,3}$/.test(prefix) && !RESERVED_PREFIXES.includes(prefix) && prefix !== 'core') ?? `${slug[0]}q`;
}

export interface TemplatePlan {
  id: string;
  key: string;
  label: string;
  for: string[];
  primary: boolean;
}

/**
 * One demo store per business picked. The primary is `default`, the rest are
 * named by their key. A business category makes a general template, a niche a
 * niche one — either way `for` is just that key, so a niche never names a
 * category (R2.7).
 */
export function planTemplates(keys: string[], primary?: string): TemplatePlan[] {
  const unique = [...new Set(keys)];
  const first = primary && unique.includes(primary) ? primary : unique[0];
  const ordered = [first, ...unique.filter((key) => key !== first)];
  return ordered.map((key, index) => ({ id: index === 0 ? 'default' : key, key, label: labelOf(key), for: [key], primary: index === 0 }));
}

/** The business categories the templates belong to, once each, in order. */
export function defaultCategories(keys: string[]): string[] {
  return [...new Set(keys.map(categoryOf))];
}
