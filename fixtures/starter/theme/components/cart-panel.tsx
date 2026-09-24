'use client';

import type { JSX } from 'react';
import type { CartPanelControllerRenderProps } from '@usequeek/theme-kit/components/cart/cart-panel-controller';
import { Image } from '@usequeek/theme-kit/components/image';
import { formatMoney } from '@usequeek/theme-kit/utils/format';

/**
 * The slide-in cart. Core's CartPanelController owns open/close state, the
 * lines and the totals; this only draws them.
 */
export function CartPanel({
  isOpen, items, total, currency, onClose, onCheckout, onSetQuantity, onRemove,
}: CartPanelControllerRenderProps): JSX.Element | null {
  if (!isOpen) return null;

  return (
    <aside className="bare-panel" role="dialog" aria-label="Cart">
      <header className="bare-panel__head">
        <h2>Cart</h2>
        <button type="button" onClick={onClose} aria-label="Close">×</button>
      </header>

      {items.length === 0 ? (
        <p className="bare-panel__empty">Your cart is empty.</p>
      ) : (
        <ul className="bare-panel__items">
          {items.map((item) => (
            <li key={item.id} className="bare-panel__item">
              <Image src={item.image ?? undefined} alt={item.title} className="bare-panel__image" />
              <div>
                <h3>{item.title}</h3>
                <p>{formatMoney(item.unit_price, currency)}</p>
                <div className="bare-panel__qty">
                  <button type="button" onClick={() => onSetQuantity(item.id, item.shop_id, item.quantity - 1)} aria-label="Decrease">−</button>
                  <span>{item.quantity}</span>
                  <button type="button" onClick={() => onSetQuantity(item.id, item.shop_id, item.quantity + 1)} aria-label="Increase">+</button>
                </div>
              </div>
              <button type="button" onClick={() => onRemove(item.id, item.shop_id)}>Remove</button>
            </li>
          ))}
        </ul>
      )}

      <footer className="bare-panel__foot">
        <p className="bare-panel__total">Total {formatMoney(total, currency)}</p>
        <button type="button" className="bare-btn" onClick={onCheckout} disabled={items.length === 0}>Checkout</button>
      </footer>
    </aside>
  );
}
