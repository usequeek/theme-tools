'use client';

import type { JSX } from 'react';
import { Link } from '@usequeek/theme-kit/navigation';
import type { ProductsBlockProps } from '@usequeek/theme-kit/types/theme';
import type { Product } from '@usequeek/theme-kit/types/product';
import { Image } from '@usequeek/theme-kit/components/image';
import { useProducts } from '@usequeek/theme-kit/hooks/use-products';
import { useHref } from '@usequeek/theme-kit/hooks/use-href';
import { formatMoney } from '@usequeek/theme-kit/utils/format';

function ProductCard({ product }: { product: Product }): JSX.Element {
  const href = useHref();

  return (
    <li className="bare-card">
      <Link href={href(`/products/${product.slug}`)}>
        <Image src={product.media.thumbnail ?? product.media.image ?? undefined} alt={product.title} className="bare-card__image" />
        <h3 className="bare-card__title">{product.title}</h3>
        <p className="bare-card__price">
          {/* A product whose variants span a range has no single price — say so. */}
          {product.pricing.is_price_from ? 'From ' : ''}
          {formatMoney(product.pricing.sale_amount, product.currency)}
        </p>
      </Link>
    </li>
  );
}

export function ProductsBlock({ products: initial, collection, ids, sort, limit, title }: ProductsBlockProps): JSX.Element | null {
  const hasInitial = Array.isArray(initial) && initial.length > 0;
  // Handed products by the renderer? Do not fetch. Otherwise ask for them.
  const { products: fetched, isLoading } = useProducts(hasInitial ? undefined : { collection, ids, sort, limit });
  const products = hasInitial ? initial : fetched;

  if (!isLoading && (!products || products.length === 0)) return null;

  return (
    <section className="bare-section" aria-busy={isLoading || undefined}>
      {/* The heading renders before the data does — a section that is blank
          while loading reads as broken, to a vendor and to `theme:check`. */}
      <h2 className="bare-section__title">{title ?? 'Products'}</h2>
      <ul className="bare-grid">
        {(products ?? []).map((product) => <ProductCard key={product.id} product={product} />)}
      </ul>
    </section>
  );
}
