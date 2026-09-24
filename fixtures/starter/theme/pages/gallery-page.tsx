import type { JSX } from 'react';
import type { GalleryPageProps } from '@usequeek/theme-kit/types/theme';
import { PageRenderer } from '@usequeek/theme-kit/page-renderer';

export function GalleryPage({ gallery }: GalleryPageProps): JSX.Element {
  const blocks = Array.isArray(gallery.content) ? gallery.content : [];

  return (
    <main className="bare-main">
      <h1 className="bare-page__title">{gallery.title}</h1>
      <PageRenderer blocks={blocks} />
    </main>
  );
}
