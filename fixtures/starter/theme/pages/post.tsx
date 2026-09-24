import type { JSX } from 'react';
import type { PostPageProps } from '@usequeek/theme-kit/types/theme';
import { renderMarkdown } from '@usequeek/theme-kit/utils/markdown';

export function PostView({ post }: PostPageProps): JSX.Element {
  return (
    <main className="bare-main">
      <h1 className="bare-page__title">{post.title}</h1>
      <article className="bare-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(String(post.content ?? '')) }} />
    </main>
  );
}
