import type { JSX } from 'react';
import { notFound } from 'next/navigation';
import { getEnrichedPage, getPost } from '@usequeek/theme-kit/demo';
import { loadStore } from '../../../_lib/stores';
import { ThemePage } from '../../../theme-page';

/** `/blog/<slug>` — one post. */
export default async function Post({ params }: { params: Promise<{ store: string; slug: string }> }): Promise<JSX.Element> {
  const { store, slug } = await params;
  const demo = loadStore(store);
  const post = demo ? getPost(demo, slug) : null;
  if (!demo || !post) notFound();
  return <ThemePage name="Post" props={{ post: getEnrichedPage(post, demo) }} />;
}
