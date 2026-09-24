import type { JSX } from 'react';
import type { LayoutProps } from '@usequeek/theme-kit/types/theme';
import './theme.css';

export function Layout({ children }: LayoutProps): JSX.Element {
  return <div className="theme-bare">{children}</div>;
}
