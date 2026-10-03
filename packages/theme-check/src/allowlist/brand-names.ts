import data from './brand-names.json' with { type: 'json' };

/**
 * Brand and unit tokens that may legitimately stay untranslated in theme UI
 * strings — product/brand names, payment rails, currency codes and units.
 * Shared helper for the locale rules; the G0-enforce slice (no hard-coded
 * strings in JSX) reuses this list so it never flags these tokens.
 */
export const BRAND_NAMES: readonly string[] = [
  ...data.brands,
  ...data.payments,
  ...data.currencies,
  ...data.units,
];

const BRAND_NAME_SET = new Set(BRAND_NAMES);

/** Exact-match check: brand tokens are case-sensitive (`Queek`, `NGN`). */
export function isBrandNameToken(value: string): boolean {
  return BRAND_NAME_SET.has(value);
}
