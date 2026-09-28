import type { JSX } from 'react';
import Link from 'next/link';
import { loadStore, stores, type StoreEntry } from './_lib/stores';

/**
 * The preview's front door: every template your theme ships, every design of
 * each, and every page each design has. A template is a business the theme is
 * dressed as; a design is one demo store of it. `/default` is theme/demo.json
 * (the main template's first design); each file in theme/demos/ is its own
 * store at `/<id>` — a design the Queek backend can build a merchant's store from.
 */
export default function Index(): JSX.Element {
  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: '48px 20px', fontFamily: 'system-ui, sans-serif', color: '#1a1a1a', lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 28, margin: '0 0 4px' }}>Theme preview</h1>
      <p style={{ margin: '0 0 32px', color: '#555' }}>Edit anything under <code>theme/</code> and the page reloads.</p>
      {stores().map((template) => (
        <section key={template.designs[0].id} style={{ borderTop: '1px solid #e5e5e5', padding: '20px 0' }}>
          <h2 style={{ fontSize: 18, margin: '0 0 2px' }}>
            {template.label}{' '}
            <span style={{ fontSize: 13, fontWeight: 400, color: '#777' }}>
              {template.designs.length === 1 ? '1 design' : `${template.designs.length} designs`}
              {template.key && template.designs[0].declared ? ` · template ${template.key}` : ''}
            </span>
          </h2>
          {template.designs.map((store) => <Design key={store.id} store={store} />)}
        </section>
      ))}
    </main>
  );
}

function Design({ store }: { store: StoreEntry }): JSX.Element {
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
    <div style={{ padding: '10px 0 0' }}>
      <h3 style={{ fontSize: 16, margin: 0 }}>
        <Link href={`/${store.id}`}>{store.label}</Link>{' '}
        <span style={{ fontSize: 13, fontWeight: 400, color: '#777' }}>/{store.id}</span>
      </h3>
      {store.declared ? null : (
        <p style={{ margin: '4px 0', color: '#a33', fontSize: 14 }}>
          Not declared in <code>theme/theme.config.ts</code> — add <code>{`{ id: '${store.id}', template, label, for, description }`}</code> to <code>demos</code>.
        </p>
      )}
      <p style={{ margin: '6px 0 0', display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 14 }}>
        {links.map(([label, path]) => (
          <Link key={path || 'home'} href={`/${store.id}${path}`}>{label}</Link>
        ))}
      </p>
    </div>
  );
}
