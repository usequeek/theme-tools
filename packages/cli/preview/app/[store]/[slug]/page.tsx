import type { JSX } from 'react';
import { notFound } from 'next/navigation';
import { getEnrichedPage } from '@usequeek/theme-kit/demo';
import { loadStore } from '../../_lib/stores';
import { ThemePage } from '../../theme-page';

/** Any other page in the store's `pages` — about, sales, landing, contact, faq… */
export default async function StorePage({ params }: { params: Promise<{ store: string; slug: string }> }): Promise<JSX.Element> {
  const { store, slug } = await params;
  const demo = loadStore(store);
  const page = demo?.pages?.[slug];
  if (!demo || !page) notFound();
  const enriched = getEnrichedPage(page, demo);
  if (enriched.type === 'post') return <ThemePage name="Post" props={{ post: enriched }} />;
  if (enriched.type === 'gallery') return <ThemePage name="Gallery" props={{ gallery: enriched }} />;
  return <ThemePage name="Page" props={{ page: enriched }} />;
}
