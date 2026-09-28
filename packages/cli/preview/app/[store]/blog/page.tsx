import type { JSX } from 'react';
import { notFound } from 'next/navigation';
import { getPosts } from '@usequeek/theme-kit/demo';
import { loadStore } from '../../_lib/stores';
import { ThemePage } from '../../theme-page';

/** `/blog` — the store's posts. */
export default async function Blog({ params }: { params: Promise<{ store: string }> }): Promise<JSX.Element> {
  const { store } = await params;
  const demo = loadStore(store);
  if (!demo) notFound();
  return <ThemePage name="Blog" props={{ posts: getPosts(demo), pagination: {} }} />;
}
