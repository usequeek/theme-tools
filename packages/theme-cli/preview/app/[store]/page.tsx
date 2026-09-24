import type { JSX } from 'react';
import { notFound } from 'next/navigation';
import { getEnrichedPage } from '@usequeek/theme-kit/demo';
import { loadStore } from '../_lib/stores';
import { ThemePage } from '../theme-page';

/** The store's home page — `pages.home` in its demo JSON. */
export default async function Home({ params }: { params: Promise<{ store: string }> }): Promise<JSX.Element> {
  const { store } = await params;
  const demo = loadStore(store);
  const home = demo?.pages?.home;
  if (!demo || !home) notFound();
  // `getEnrichedPage` resolves the references in a section — product ids, a
  // collection, image keys — into the objects your blocks receive.
  return <ThemePage name="Home" props={{ blocks: getEnrichedPage(home, demo).content ?? [] }} />;
}
