'use client';

import type { JSX } from 'react';
import type { ProductPageProps } from '@usequeek/theme-kit/types/theme';
import { ProductMetafields } from '@usequeek/theme-kit/components/product-metafields';
import { Image } from '@usequeek/theme-kit/components/image';
import { useCart } from '@usequeek/theme-kit/hooks/use-cart';
import { useVariantSelection } from '@usequeek/theme-kit/hooks/use-variant-selection';
import { formatMoney } from '@usequeek/theme-kit/utils/format';

export function Product({ product, metafieldDefinitions }: ProductPageProps): JSX.Element {
  const { addProduct } = useCart();
  // Core owns option state: it seeds from a variant that exists and tells you
  // when the selection resolves to one. Never add without variantSatisfied.
  const { selectedOptions, selectOption, matchedVariant, variantSatisfied, activePrice, activeInStock } =
    useVariantSelection(product);

  return (
    <main className="bare-main bare-product">
      <Image src={product.media.image ?? product.media.thumbnail ?? undefined} alt={product.title} className="bare-product__image" />

      <div className="bare-product__body">
        <h1 className="bare-page__title">{product.title}</h1>
        <p className="bare-product__price">{formatMoney(activePrice, product.currency)}</p>

        {product.options.map((option) => (
          <fieldset className="bare-product__option" key={option.name}>
            <legend>{option.name}</legend>
            {option.values.map((value) => (
              <button
                type="button"
                key={value.value}
                aria-pressed={selectedOptions[option.name] === value.value}
                onClick={() => selectOption(option.name, value.value)}
              >
                {value.label}
              </button>
            ))}
          </fieldset>
        ))}

        <button
          type="button"
          className="bare-btn"
          disabled={!activeInStock || !variantSatisfied}
          onClick={() => addProduct(product, 1, matchedVariant)}
        >
          {!variantSatisfied ? 'Select options' : activeInStock ? 'Add to cart' : 'Sold out'}
        </button>

        <ProductMetafields product={product} definitions={metafieldDefinitions} />
      </div>
    </main>
  );
}
