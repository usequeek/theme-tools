import type { DevStore } from '../../lib/app-api.js';

/** One line per dev store: p_id, name, slug, test data, storefront. Never a password. */
export function devStoreLines(stores: DevStore[]): string[] {
  if (stores.length === 0) return ['No dev stores yet — `queek dev-store create <name>` makes one with test data.'];
  return stores.map((store) => {
    const data = store.test_data_status ? ` · test data: ${store.test_data_status}` : '';
    const url = store.storefront_url ? ` · ${store.storefront_url}` : '';
    return `${store.p_id}  ${store.name} (${store.slug})${data}${url}`;
  });
}
