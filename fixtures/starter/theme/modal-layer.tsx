'use client';

import type { JSX } from 'react';
import { CartPanelController } from '@usequeek/theme-kit/components/cart/cart-panel-controller';
import { CartPanel } from './components/cart-panel';

/**
 * The theme's modal surface. Core owns the auth modal separately (CoreModalLayer).
 *
 * A bare theme mounts only the cart panel. Add a search modal, a product
 * quick-view or an orders sheet when your design calls for them — the stores
 * that open them (useSearchModalStore, useProductModalStore,
 * useOrdersSheetStore) are core's, so you supply only the presentation.
 */
export function ModalLayer(): JSX.Element {
  return (
    <CartPanelController>
      {(cartPanelProps) => <CartPanel {...cartPanelProps} />}
    </CartPanelController>
  );
}
