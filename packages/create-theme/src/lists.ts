/**
 * The lists a developer picks from, bundled at build time from the storefront
 * (their source of truth, synced by `yarn tools:sync-lists` there): no network
 * before a question is asked, and the same vocabulary the checker of this
 * release enforces.
 */
import vocabulary from './data/business-vocabulary.json' with { type: 'json' };
import labels from './data/business-labels.json' with { type: 'json' };
import tags from './data/theme-tags.json' with { type: 'json' };
import reserved from './data/reserved.json' with { type: 'json' };

const CATALOGUE = vocabulary.catalogue as Record<string, string[]>;
const SUBCATEGORIES = vocabulary.subcategories as Record<string, string[]>;

/** Business categories: what a vendor picks at setup (R2.7). */
export const SERVICES: readonly string[] = vocabulary.services;

const ROOT_OF = new Map<string, string>();
for (const [root, branches] of Object.entries(CATALOGUE)) {
  ROOT_OF.set(root, root);
  for (const branch of branches) ROOT_OF.set(branch, root);
}
for (const [branch, children] of Object.entries(SUBCATEGORIES)) {
  for (const child of children) ROOT_OF.set(child, ROOT_OF.get(branch) ?? branch);
}

/** Catalogue keys that are not also a business category: a template for one kind of product. */
export const NICHES: readonly string[] = [...ROOT_OF.keys()].filter((key) => !SERVICES.includes(key));
export const BUSINESS_KEYS: readonly string[] = [...SERVICES, ...NICHES];
export const TAGS: readonly string[] = tags.tags;
export const RESERVED_SLUGS: readonly string[] = reserved.slugs;
export const RESERVED_PREFIXES: readonly string[] = reserved.prefixes;

/** Catalogue roots that are not a business category, and the category their vendors pick. */
const ROOT_SERVICE: Record<string, string> = {
  'beauty-personal-care': 'beauty-cosmetics',
  'phones-tablets': 'phones-accessories',
  'health-wellness': 'health-wellness-store',
};

/** The business category any key belongs to (`jewelry` → `fashion`). */
export function categoryOf(key: string): string {
  if (SERVICES.includes(key)) return key;
  const root = ROOT_OF.get(key) ?? key;
  return SERVICES.includes(root) ? root : (ROOT_SERVICE[root] ?? root);
}

export function labelOf(key: string): string {
  return (labels.labels as Record<string, string>)[key] ?? key;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** The closest candidate within a few edits ("jewellery" → "jewelry"), or null. */
export function nearest(value: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestDistance = Math.max(2, Math.floor(value.length / 4)) + 1;
  for (const candidate of candidates) {
    const d = distance(value, candidate);
    if (d < bestDistance) [best, bestDistance] = [candidate, d];
  }
  return best;
}
