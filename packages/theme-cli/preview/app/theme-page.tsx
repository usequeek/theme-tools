'use client';

import type { JSX } from 'react';
import type { ThemeModule } from '@usequeek/theme-kit/types/theme';
import theme from '../theme-entry';

type PageName = keyof ThemeModule['pages'];

/**
 * Renders one of your theme's pages. Routes are server components that read the
 * demo store; your pages are client components, so the route hands this the page
 * name and its (plain JSON) props — the same way the live storefront does.
 */
export function ThemePage({ name, props }: { name: PageName; props: Record<string, unknown> }): JSX.Element {
  const Page = theme.pages[name] as ((props: Record<string, unknown>) => JSX.Element) | undefined;
  if (!Page) {
    return (
      <p style={{ padding: 48, fontFamily: 'system-ui, sans-serif' }}>
        Your theme has no <code>pages.{name}</code>. Add it in <code>theme/index.ts</code>.
      </p>
    );
  }
  return <Page {...props} />;
}
