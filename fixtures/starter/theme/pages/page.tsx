'use client';

import type { JSX } from 'react';
import type { GenericPageProps } from '@usequeek/theme-kit/types/theme';
import { PageRenderer } from '@usequeek/theme-kit/page-renderer';
import { useStorefront } from '@usequeek/theme-kit/provider';
import { renderMarkdown } from '@usequeek/theme-kit/utils/markdown';

export function PageView({ page }: GenericPageProps): JSX.Element {
  const { basePath } = useStorefront();
  const blocks = Array.isArray(page.content) ? page.content : [];

  return (
    <main className="bare-main">
      <h1 className="bare-page__title">{page.title}</h1>
      {blocks.length > 0
        ? <PageRenderer blocks={blocks} />
        : <div className="bare-prose">{renderMarkdown(String(page.content ?? ''), basePath)}</div>}
    </main>
  );
}
