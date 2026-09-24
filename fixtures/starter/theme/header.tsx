'use client';

import type { JSX } from 'react';
import Link from 'next/link';
import type { HeaderProps } from '@usequeek/theme-kit/types/theme';
import { useStorefront } from '@usequeek/theme-kit/provider';
import { Image } from '@usequeek/theme-kit/components/image';
import { useCart } from '@usequeek/theme-kit/hooks/use-cart';
import { useCartPanelStore } from '@usequeek/theme-kit/stores/cart-panel-store';
import { menuItemKey, menuItemToHref } from '@usequeek/theme-kit/utils/menu-link';

export function Header({ menu, logo }: HeaderProps): JSX.Element {
  const { vendor, basePath } = useStorefront();
  const { items } = useCart();
  const openCart = useCartPanelStore((state) => state.open);
  const count = items.reduce((total, item) => total + item.quantity, 0);

  return (
    <header className="bare-header">
      <Link href={basePath || '/'} className="bare-header__brand">
        {logo ? <Image src={logo} alt={vendor.name ?? ''} className="bare-header__logo" /> : null}
        <span>{vendor.name}</span>
      </Link>

      {menu.length > 0 ? (
        <nav className="bare-header__nav" aria-label="Main">
          {menu.map((item, index) => (
            <Link key={menuItemKey(item, index)} href={menuItemToHref(item, basePath)}>
              {item.label}
            </Link>
          ))}
        </nav>
      ) : null}

      <button type="button" className="bare-header__cart" onClick={openCart}>
        Cart{count > 0 ? ` (${count})` : ''}
      </button>
    </header>
  );
}
