'use client';

import type { JSX } from 'react';
import type { CartShellProps } from '@usequeek/theme-kit/types/theme';
import { Image } from '@usequeek/theme-kit/components/image';
import { formatMoney } from '@usequeek/theme-kit/utils/format';

/**
 * A shell arranges what core hands it. Core owns the cart's behaviour —
 * quantities, removal, totals — and passes them in; this decides how they look.
 */
export function CartShell({ items, currency, total, empty, onIncrease, onDecrease, onRemove }: CartShellProps): JSX.Element {
  if (empty) return <p className="bare-cart__empty">Your cart is empty.</p>;

  return (
    <div className="bare-cart">
      <ul className="bare-cart__items">
        {items.map((item) => (
          <li key={item.id} className="bare-cart__item">
            <Image src={item.image ?? undefined} alt={item.title} className="bare-cart__image" />
            <div>
              <h3 className="bare-cart__title">{item.title}</h3>
              <p className="bare-cart__price">{formatMoney(item.unit_price, currency)}</p>
              <div className="bare-cart__qty">
                <button type="button" onClick={() => onDecrease(item.id, item.shop_id)} aria-label="Decrease">−</button>
                <span>{item.quantity}</span>
                <button type="button" onClick={() => onIncrease(item.id, item.shop_id)} aria-label="Increase">+</button>
              </div>
            </div>
            <button type="button" className="bare-cart__remove" onClick={() => onRemove(item.id, item.shop_id)}>Remove</button>
          </li>
        ))}
      </ul>
      <p className="bare-cart__total">Total {formatMoney(total, currency)}</p>
    </div>
  );
}
