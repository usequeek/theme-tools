import type { JSX } from 'react';
import Link from 'next/link';
import { loadStore, stores } from './_lib/stores';

/**
 * The preview's front door: every store your theme ships, and every page each
 * one has. `/default` is theme/demo.json; each file in theme/demos/ is its own
 * store at `/<id>` — a template the Queek backend can build a merchant's store from.
 */
export default function Index(): JSX.Element {
  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: '48px 20px', fontFamily: 'system-ui, sans-serif', color: '#1a1a1a', lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 28, margin: '0 0 4px' }}>Theme preview</h1>
      <p style={{ margin: '0 0 32px', color: '#555' }}>Edit anything under <code>theme/</code> and the page reloads.</p>
      {stores().map((store) => {
        const demo = loadStore(store.id);
        // home is the store's root; a `shop` page is superseded by the /shop route.
        const pages = Object.keys(demo?.pages ?? {}).filter((slug) => slug !== 'home' && slug !== 'shop');
        const product = demo?.products?.[0];
        const links: Array<[string, string]> = [
          ['Home', ''],
          ...pages.map((slug): [string, string] => [slug, `/${slug}`]),
          ['Shop', '/shop'],
          ...(product ? [[`Product: ${product.title}`, `/products/${product.slug}`] as [string, string]] : []),
          ['Collections', '/collections'],
          ['Blog', '/blog'],
        ];
        return (
          <section key={store.id} style={{ borderTop: '1px solid #e5e5e5', padding: '20px 0' }}>
            <h2 style={{ fontSize: 18, margin: '0 0 2px' }}>
              <Link href={`/${store.id}`}>{store.label}</Link>{' '}
              <span style={{ fontSize: 13, fontWeight: 400, color: '#777' }}>/{store.id}</span>
            </h2>
            {store.declared ? null : (
              <p style={{ margin: '4px 0', color: '#a33', fontSize: 14 }}>
                Not declared in <code>theme/theme.config.ts</code> — add <code>{`{ id: '${store.id}', label, for, description }`}</code> to <code>demos</code>.
              </p>
            )}
            <p style={{ margin: '8px 0 0', display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 14 }}>
              {links.map(([label, path]) => (
                <Link key={path || 'home'} href={`/${store.id}${path}`}>{label}</Link>
              ))}
            </p>
          </section>
        );
      })}
    </main>
  );
}
