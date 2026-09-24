/**
 * The business vocabulary a template's `for` speaks (business-vocabulary.json):
 * the service slugs a vendor registers as, plus the marketplace catalogue's
 * roots and branches — what tells a wig seller from a makeup seller when both
 * register as beauty. Agreed with the backend; theme-check rejects any other key.
 */
import vocabulary from './business-vocabulary.json' with { type: 'json' };

export const SERVICE_SLUGS: readonly string[] = vocabulary.services;
export const CATALOGUE: Readonly<Record<string, readonly string[]>> = vocabulary.catalogue;

const ROOT_OF = new Map<string, string>(Object.entries(CATALOGUE).flatMap(([root, branches]) => [[root, root] as const, ...branches.map((branch) => [branch, root] as const)]));

export const BUSINESS_KEYS: ReadonlySet<string> = new Set([...SERVICE_SLUGS, ...ROOT_OF.keys()]);

export function isBusinessKey(key: string): boolean {
  return BUSINESS_KEYS.has(key);
}

/** A catalogue branch's root (`wigs-extensions-hair-accessories` → `beauty-personal-care`); any other key is its own. */
export function businessRoot(key: string): string {
  return ROOT_OF.get(key) ?? key;
}
