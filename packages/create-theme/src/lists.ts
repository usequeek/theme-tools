/**
 * The lists a developer picks from, bundled at build time from the storefront
 * (their source of truth, synced by `yarn tools:sync-lists` there): no network
 * before a question is asked, and the same vocabulary the checker of this
 * release enforces.
 *
 * A run's lists are a BusinessLists built from one vocabulary copy: the
 * cached-or-bundled copy while prompting, the live copy for the final check
 * (see runCreate). Labels and root→service come from that copy's
 * `labels`/`root_service` — no hand-kept maps. The module-level constants are
 * the bundled copy, for compatibility.
 */
import { readCachedVocabulary } from '@usequeek/theme-check';
import vocabulary from './data/business-vocabulary.json' with { type: 'json' };
import labels from './data/business-labels.json' with { type: 'json' };
import tags from './data/theme-tags.json' with { type: 'json' };
import reserved from './data/reserved.json' with { type: 'json' };

/** One vocabulary copy as the pickers read it. */
export interface ListsData {
  services: string[];
  catalogue: Record<string, string[]>;
  subcategories: Record<string, string[]>;
  root_service?: Record<string, string>;
  labels?: Record<string, string>;
}

export interface BusinessOption {
  value: string;
  label: string;
  hint?: string;
}

/** `shop` in the pickers: last, under this name, with this hint. It is for a general store only. */
export const SHOP_KEY = 'shop';
export const SHOP_LABEL = 'General store';
export const SHOP_HINT = 'pick a specific business; this is for a general store only';

/** One vocabulary copy's pickers: services, niches, labels, categories. */
export interface BusinessLists {
  /** Business categories, `shop` last. */
  services: readonly string[];
  /** Catalogue keys that are not also a business category. */
  niches: readonly string[];
  /** Every key: services plus niches. */
  businessKeys: readonly string[];
  /** The business category any key belongs to (`jewelry` → `fashion`). */
  categoryOf: (key: string) => string;
  /** The display name of any key, from the vocabulary's labels. */
  labelOf: (key: string) => string;
  /** The templates picker: services (`shop` last) then niches, `shop` as "General store". */
  templateOptions: () => BusinessOption[];
  /** The categories picker: services, `shop` last and as "General store". */
  categoryOptions: () => BusinessOption[];
}

function rootsOf(data: ListsData): Map<string, string> {
  const roots = new Map<string, string>();
  for (const [root, branches] of Object.entries(data.catalogue)) {
    roots.set(root, root);
    for (const branch of branches) roots.set(branch, root);
  }
  for (const [branch, children] of Object.entries(data.subcategories)) {
    for (const child of children) roots.set(child, roots.get(branch) ?? branch);
  }
  return roots;
}

/** The pickers for one vocabulary copy. */
export function createLists(data: ListsData): BusinessLists {
  const roots = rootsOf(data);
  const labelsOf = data.labels ?? {};
  const rootService = data.root_service ?? {};
  const services = [...data.services.filter((key) => key !== SHOP_KEY), ...data.services.filter((key) => key === SHOP_KEY)];
  const niches = [...roots.keys()].filter((key) => !data.services.includes(key));
  // `shop` is offered dead last whatever kind of key it is: it is for a general store only.
  const hasShop = data.services.includes(SHOP_KEY) || niches.includes(SHOP_KEY);
  const servicesNoShop = services.filter((key) => key !== SHOP_KEY);
  const nichesNoShop = niches.filter((key) => key !== SHOP_KEY);
  const businessKeys = [...servicesNoShop, ...nichesNoShop, ...(hasShop ? [SHOP_KEY] : [])];

  const categoryOf = (key: string): string => {
    if (data.services.includes(key)) return key;
    const root = roots.get(key) ?? key;
    return data.services.includes(root) ? root : (rootService[root] ?? root);
  };
  const labelOf = (key: string): string => labelsOf[key] ?? key;
  const option = (key: string, hint: string): BusinessOption =>
    key === SHOP_KEY
      ? { value: key, label: SHOP_LABEL, hint: SHOP_HINT }
      : { value: key, label: labelOf(key), hint };
  return {
    services,
    niches,
    businessKeys,
    categoryOf,
    labelOf,
    templateOptions: () => [
      ...servicesNoShop.map((key) => option(key, 'business category')),
      ...nichesNoShop.map((key) => option(key, `niche · ${labelOf(categoryOf(key))}`)),
      ...(hasShop ? [option(SHOP_KEY, 'business category')] : []),
    ],
    categoryOptions: () => services.map((key) => option(key, 'business category')),
  };
}

/** The bundled copy: the synced vocabulary plus the synced labels. */
export function bundledLists(): BusinessLists {
  return createLists({
    services: vocabulary.services as string[],
    catalogue: vocabulary.catalogue as Record<string, string[]>,
    subcategories: vocabulary.subcategories as Record<string, string[]>,
    root_service: (vocabulary as { root_service?: Record<string, string> }).root_service,
    labels: (labels.labels ?? {}) as Record<string, string>,
  });
}

const BUNDLED = bundledLists();

let active: BusinessLists = BUNDLED;

/** The lists the current run prompts from (runCreate sets these at launch). */
export function getActiveLists(): BusinessLists {
  return active;
}

/** Set the lists the current run prompts from. runCreate restores the bundled copy when it finishes. */
export function setActiveLists(lists: BusinessLists): void {
  active = lists;
}

/** The cached copy, synchronously, for prompts that must ask before any fetch returns. Null when absent or invalid. */
export function cachedLists(): BusinessLists | null {
  const cached = readCachedVocabulary();
  if (!cached) return null;
  const bundled = BUNDLED;
  return createLists({
    services: cached.services,
    catalogue: cached.catalogue,
    subcategories: cached.subcategories,
    root_service: cached.root_service,
    // A cache from before labels were stored still gets the bundled names.
    labels: cached.labels ?? Object.fromEntries(bundled.businessKeys.map((key) => [key, bundled.labelOf(key)])),
  });
}

/** Business categories: what a vendor picks at setup (R2.7). */
export const SERVICES: readonly string[] = BUNDLED.services;

/** Catalogue keys that are not also a business category: a template for one kind of product. */
export const NICHES: readonly string[] = BUNDLED.niches;
export const BUSINESS_KEYS: readonly string[] = BUNDLED.businessKeys;
export const TAGS: readonly string[] = tags.tags;
export const RESERVED_SLUGS: readonly string[] = reserved.slugs;
export const RESERVED_PREFIXES: readonly string[] = reserved.prefixes;

/** The business category any key belongs to (`jewelry` → `fashion`). */
export function categoryOf(key: string): string {
  return BUNDLED.categoryOf(key);
}

export function labelOf(key: string): string {
  return BUNDLED.labelOf(key);
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
