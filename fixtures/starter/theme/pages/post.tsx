'use client';

import type { JSX } from 'react';
import type { PostPageProps } from '@usequeek/theme-kit/types/theme';
import { useStorefront } from '@usequeek/theme-kit/provider';
import { renderMarkdown } from '@usequeek/theme-kit/utils/markdown';

export function PostView({ post }: PostPageProps): JSX.Element {
  const { basePath } = useStorefront();

  return (
    <main className="bare-main">
      <h1 className="bare-page__title">{post.title}</h1>
      <article className="bare-prose">{renderMarkdown(String(post.content ?? ''), basePath)}</article>
    </main>
  );
}
