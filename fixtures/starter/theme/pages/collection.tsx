import type { JSX } from 'react';
import type { CollectionPageProps } from '@usequeek/theme-kit/types/theme';
import { ProductsBlock } from '../blocks/products';

export function Collection({ collection, products }: CollectionPageProps): JSX.Element {
  return (
    <main className="bare-main">
      <h1 className="bare-page__title">{collection.name}</h1>
      <ProductsBlock products={products} />
    </main>
  );
}
