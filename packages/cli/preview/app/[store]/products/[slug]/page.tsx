import type { JSX } from 'react';
import { notFound } from 'next/navigation';
import { loadStore } from '../../../_lib/stores';
import { ThemePage } from '../../../theme-page';

/** `/products/<slug>` — one product from the store's `products`. */
export default async function Product({ params }: { params: Promise<{ store: string; slug: string }> }): Promise<JSX.Element> {
  const { store, slug } = await params;
  const product = loadStore(store)?.products?.find((item) => item.slug === slug);
  if (!product) notFound();
  return <ThemePage name="Product" props={{ product }} />;
}
