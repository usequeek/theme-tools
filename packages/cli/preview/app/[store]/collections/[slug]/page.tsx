import type { JSX } from 'react';
import { notFound } from 'next/navigation';
import { getCollection } from '@usequeek/theme-kit/demo';
import { loadStore } from '../../../_lib/stores';
import { ThemePage } from '../../../theme-page';

/** `/collections/<slug>` — one collection and its products. */
export default async function Collection({ params }: { params: Promise<{ store: string; slug: string }> }): Promise<JSX.Element> {
  const { store, slug } = await params;
  const demo = loadStore(store);
  const found = demo ? getCollection(demo, slug) : null;
  if (!found) notFound();
  return <ThemePage name="Collection" props={{ collection: found.collection, products: found.products }} />;
}
