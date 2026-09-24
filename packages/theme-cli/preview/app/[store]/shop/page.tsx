import type { JSX } from 'react';
import { notFound } from 'next/navigation';
import type { ShopCategory } from '@usequeek/theme-kit/types/theme';
import { loadStore } from '../../_lib/stores';
import { ThemePage } from '../../theme-page';

/** `/shop` — the whole catalogue. Your Shop page loads products itself through `useShop`. */
export default async function Shop({ params }: { params: Promise<{ store: string }> }): Promise<JSX.Element> {
  const { store } = await params;
  const demo = loadStore(store);
  if (!demo) notFound();
  const products = demo.products ?? [];
  const categories: ShopCategory[] = (demo.categories ?? []).map((category) => ({
    id: category.id,
    slug: category.slug,
    name: category.name,
    image: category.image ?? null,
    products_count: products.filter((product) => product.categories.some((item) => item.slug === category.slug)).length,
  }));
  return <ThemePage name="Shop" props={{ categories }} />;
}
