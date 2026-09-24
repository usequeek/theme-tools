import type { JSX } from 'react';
import type { HomePageProps } from '@usequeek/theme-kit/types/theme';
import { PageRenderer } from '@usequeek/theme-kit/page-renderer';

/** The merchant's composed sections, in their order. */
export function Home({ blocks }: HomePageProps): JSX.Element {
  return <main className="bare-main"><PageRenderer blocks={blocks} /></main>;
}
