import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { flattenLocaleEntries } from './utils/locale-files.js';

/**
 * Kit core dictionary keys the enforce rules accept without a theme entry.
 *
 * CHOICE (documented per the G0-enforce brief): theme-check learns the kit
 * core keys from this generated snapshot — NOT a new dependency. Depending
 * on the kit would drag its React/Next graph into a lint library; reading
 * the kit at install time would couple every check run to whatever kit the
 * theme happens to have installed. Instead `scripts/sync-kit-core-strings.mjs`
 * regenerates this file from the kit's `locales/en.default.json`, and the
 * drift test in `test/locale-enforce.test.ts` fails when a resolvable kit
 * dictionary disagrees with it.
 *
 * At check time the rule ALSO layers in the theme project's own installed
 * kit dictionary when it is readable (walk up from the theme dir to
 * `node_modules/@usequeek/theme-kit/locales/en.default.json`), so a kit
 * that gained keys since this snapshot was cut never false-positives. The
 * snapshot is the floor; the project's kit is the ceiling.
 */

/** Where this snapshot was cut from (package + file, for the sync script). */
export const KIT_CORE_SOURCE = '@usequeek/theme-kit@0.1.19 locales/en.default.json';

/** Sorted flattened keys of the kit core English dictionary (generated). */
export const KIT_CORE_KEYS: readonly string[] = [
  'auth.code.change',
  'auth.code.digit',
  'auth.code.lead',
  'auth.code.resend',
  'auth.code.title',
  'auth.code.verify',
  'auth.code.verifying',
  'auth.email.continue',
  'auth.email.google',
  'auth.email.or',
  'auth.email.password',
  'auth.email.placeholder',
  'auth.email.sending',
  'auth.email.subtitle',
  'auth.email.title',
  'auth.error.code',
  'auth.error.credentials',
  'auth.error.exists',
  'auth.error.firstname',
  'auth.error.generic',
  'auth.error.google',
  'auth.error.method',
  'auth.error.phone',
  'auth.error.register',
  'auth.error.resend',
  'auth.login.code',
  'auth.login.create',
  'auth.login.email',
  'auth.login.password',
  'auth.login.signing',
  'auth.login.subtitle',
  'auth.login.title',
  'auth.register.creating',
  'auth.register.email',
  'auth.register.first',
  'auth.register.last',
  'auth.register.password',
  'auth.register.signin',
  'auth.register.subtitle',
  'auth.register.title',
  'auth.signup.create',
  'auth.signup.creating',
  'auth.signup.different',
  'auth.signup.first',
  'auth.signup.last',
  'auth.signup.subtitle',
  'auth.signup.title',
  'blog.filter.all',
  'blog.filter.nav',
  'blog.meta.reading',
  'blog.pagination.nav',
  'blog.pagination.next',
  'blog.pagination.page',
  'blog.pagination.prev',
  'blog.related.title',
  'blog.share.action',
  'blog.share.copied',
  'blog.share.copy',
  'blog.share.facebook',
  'blog.share.label',
  'blog.share.whatsapp',
  'blog.share.x',
  'cart.checkout.action',
  'cart.empty.browse',
  'cart.empty.message',
  'cart.item.decrease',
  'cart.item.each',
  'cart.item.increase',
  'cart.item.remove',
  'cart.note.placeholder',
  'cart.note.toggle',
  'cart.related.add',
  'cart.related.choose',
  'cart.related.from',
  'cart.related.next',
  'cart.related.prev',
  'cart.related.title',
  'cart.summary.continue',
  'cart.summary.subtotal',
  'cart.summary.title',
  'cart.terms.agree',
  'cart.terms.policy',
  'cart.title',
  'checkout.address.title',
  'checkout.contact.label',
  'checkout.contact.options',
  'checkout.contact.signin',
  'checkout.contact.signout',
  'checkout.delivery.title',
  'checkout.empty.browse',
  'checkout.empty.message',
  'checkout.page.back',
  'checkout.payment.secure',
  'checkout.payment.title',
  'checkout.policy.close',
  'checkout.policy.list',
  'checkout.policy.view',
  'checkout.schedule.title',
  'checkout.summary.empty',
  'checkout.summary.proceed',
  'checkout.summary.subtotal',
  'checkout.summary.title',
  'checkout.tabs.checkout',
  'checkout.tabs.summary',
  'checkout.zone.title',
];

const KIT_SNAPSHOT = new Set<string>(KIT_CORE_KEYS);

/** Basename the kit dictionary is looked up under, from a theme project. */
const KIT_DICT_SUFFIX = 'node_modules/@usequeek/theme-kit/locales/en.default.json';

/**
 * The kit core keys for a theme: the snapshot unioned with the theme
 * project's own installed kit dictionary when it is readable. Never throws —
 * an unreadable kit just means the snapshot alone.
 */
export function kitCoreKeysFor(themeDir: string): Set<string> {
  const keys = new Set<string>(KIT_SNAPSHOT);
  let dir = themeDir;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, KIT_DICT_SUFFIX);
    if (existsSync(candidate)) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf8'));
        for (const { key } of flattenLocaleEntries(parsed).leaves) keys.add(key);
      } catch {
        // A half-written kit dictionary is the kit's problem, not the theme's.
      }
      break;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return keys;
}
