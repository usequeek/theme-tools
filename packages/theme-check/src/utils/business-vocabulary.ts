/**
 * The business vocabulary a template's `for` speaks (business-vocabulary.json):
 * the service slugs a vendor registers as, plus the marketplace catalogue's
 * roots and branches — what tells a wig seller from a makeup seller when both
 * register as beauty. Agreed with the backend; theme-check rejects any other key.
 *
 * The module-level sets describe the bundled snapshot (what offline callers
 * and the storefront's offline tests check against). A resolved vocabulary —
 * live, cache or file, via `resolveVocabulary()` — travels as a
 * VocabularyView: `vocabularyViewOf(data)`, carried on the ThemeContext so
 * rules never read the module-level import.
 */
import vocabulary from './business-vocabulary.json' with { type: 'json' };
import type { BusinessVocabularyData } from '../vocabulary.js';

/** One vocabulary copy as the rules read it: sets plus the helpers. */
export interface VocabularyView {
  version: string;
  services: readonly string[];
  catalogue: Readonly<Record<string, readonly string[]>>;
  subcategories: Readonly<Record<string, readonly string[]>>;
  rootService: Readonly<Record<string, string>>;
  labels: Readonly<Record<string, string>>;
  businessKeys: ReadonlySet<string>;
  isBusinessKey: (key: string) => boolean;
  businessRoot: (key: string) => string;
}

function rootsOf(data: Pick<BusinessVocabularyData, 'catalogue' | 'subcategories'>): Map<string, string> {
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

/** Any vocabulary copy (resolved, bundled, pinned) as the rules read it. */
export function vocabularyViewOf(data: BusinessVocabularyData): VocabularyView {
  const roots = rootsOf(data);
  const services: readonly string[] = [...data.services];
  const businessKeys: ReadonlySet<string> = new Set([...services, ...roots.keys()]);
  return {
    version: data.version ?? 'unknown',
    services,
    catalogue: data.catalogue,
    subcategories: data.subcategories,
    rootService: data.root_service ?? {},
    labels: data.labels ?? {},
    businessKeys,
    isBusinessKey: (key: string): boolean => businessKeys.has(key),
    businessRoot: (key: string): string => roots.get(key) ?? key,
  };
}

const BUNDLED = vocabularyViewOf({
  version: (vocabulary as { version?: string }).version,
  services: vocabulary.services,
  catalogue: vocabulary.catalogue,
  subcategories: vocabulary.subcategories,
  root_service: (vocabulary as { root_service?: Record<string, string> }).root_service,
});

/** The bundled snapshot as the rules read it: what `checkTheme` uses unless a vocabulary is passed. */
export const bundledVocabularyView: VocabularyView = BUNDLED;

export const SERVICE_SLUGS: readonly string[] = BUNDLED.services;
export const CATALOGUE: Readonly<Record<string, readonly string[]>> = BUNDLED.catalogue;
/** A branch's own children, a third level (`bags-accessories` → `jewelry`). */
export const SUBCATEGORIES: Readonly<Record<string, readonly string[]>> = BUNDLED.subcategories;
/** A catalogue root's business category where they differ (`phones-tablets` → `phones-accessories`). */
export const ROOT_SERVICE: Readonly<Record<string, string>> = BUNDLED.rootService;
/** The bundled snapshot's version (the synced S1 snapshot). */
export const BUNDLED_VERSION: string = BUNDLED.version;

export const BUSINESS_KEYS: ReadonlySet<string> = BUNDLED.businessKeys;

export function isBusinessKey(key: string): boolean {
  return BUNDLED.isBusinessKey(key);
}

/** A catalogue key's root (`wigs-extensions-hair-accessories` → `beauty-personal-care`, `jewelry` → `fashion`); any other key is its own. */
export function businessRoot(key: string): string {
  return BUNDLED.businessRoot(key);
}
