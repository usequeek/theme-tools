import type { JSX, ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { loadStore } from '../_lib/stores';
import { Preview } from '../preview';

/**
 * One demo store, at `/<store>` — `/default` is theme/demo.json, `/food` is
 * theme/demos/food.json. Everything under it (pages, shop, products, blog)
 * renders inside your Layout, header and footer, with that store's data.
 */
export default async function StoreLayout({ children, params }: { children: ReactNode; params: Promise<{ store: string }> }): Promise<JSX.Element> {
  const { store } = await params;
  const demo = loadStore(store);
  if (!demo) notFound();
  return <Preview demo={demo} basePath={`/${store}`}>{children}</Preview>;
}
