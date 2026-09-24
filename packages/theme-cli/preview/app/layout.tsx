import type { Metadata } from 'next';
import type { JSX, ReactNode } from 'react';
import '@usequeek/theme-kit/shared-blocks/core-blocks.css';
import '@usequeek/theme-kit/apps/apps.css';
import '../theme-styles';

export const metadata: Metadata = {
  title: 'Theme preview',
  robots: 'noindex, nofollow',
};

export default function RootLayout({ children }: { children: ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
