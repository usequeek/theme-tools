'use client';

import type { JSX, ReactNode } from 'react';
import { StorefrontProvider } from '@usequeek/theme-kit/provider';
import { ThemeMount } from '@usequeek/theme-kit/theme-mount';
import { getPosts, getVendorReviews, type PreviewDemoData } from '@usequeek/theme-kit/demo';
import theme from '../theme-entry';

/**
 * Mounts your theme around every page of one demo store — no backend, no
 * vendor account.
 *
 * This is the same composition the live storefront uses: StorefrontProvider
 * supplies vendor/config/menus, ThemeMount renders your Layout with your header
 * and footer around the page. `previewData` is what lets the kit's hooks
 * (useProducts, useCategories, …) return your demo.json instead of calling an
 * API, so every component you build sees realistic data offline.
 */
export function Preview({ demo, basePath, children }: { demo: PreviewDemoData; basePath: string; children: ReactNode }): JSX.Element {
  const headerMenu = demo.menus.find((m) => m.location === 'header')?.items ?? [];

  return (
    <StorefrontProvider
      // Every link your theme builds (menuItemToHref, useHref) starts here, so
      // navigating keeps you inside this store — as `/<theme>~<store>` does live.
      basePath={basePath}
      config={demo.config}
      menus={demo.menus}
      vendor={demo.profile}
      previewData={{
        products: demo.products ?? [],
        categories: demo.categories ?? [],
        posts: getPosts(demo),
        reviews: getVendorReviews(demo),
      }}
    >
      <ThemeMount
        theme={theme}
        headerProps={{
          announcement: demo.config.header?.announcement ?? null,
          logo: demo.config.header?.logo_url ?? demo.profile.logo,
          menu: headerMenu,
          showSearch: demo.config.header?.show_search ?? true,
          showCart: demo.config.header?.show_cart ?? true,
          showAccount: demo.config.header?.show_account ?? true,
          showOffers: demo.config.header?.show_offers ?? true,
        }}
        footerProps={{
          heading: demo.config.footer?.heading,
          tagline: demo.config.footer?.tagline,
          columns: demo.config.footer?.columns,
          copyright: demo.config.footer?.copyright,
          socials: demo.config.footer?.socials,
        }}
      >
        {children}
      </ThemeMount>
    </StorefrontProvider>
  );
}
