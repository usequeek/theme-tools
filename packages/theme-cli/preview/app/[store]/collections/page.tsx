import type { JSX } from 'react';
import { notFound } from 'next/navigation';
import { getCollections } from '@usequeek/theme-kit/demo';
import { loadStore } from '../../_lib/stores';
import { ThemePage } from '../../theme-page';

/** `/collections` — the curated collections. Hero and "view all" buttons link to /shop, not here. */
export default async function Collections({ params }: { params: Promise<{ store: string }> }): Promise<JSX.Element> {
  const { store } = await params;
  const demo = loadStore(store);
  if (!demo) notFound();
  return <ThemePage name="Collections" props={{ collections: getCollections(demo) }} />;
}
