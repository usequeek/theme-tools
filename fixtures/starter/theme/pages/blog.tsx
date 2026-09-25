import type { JSX } from 'react';
import { Link } from '@usequeek/theme-kit/navigation';
import type { BlogPageProps } from '@usequeek/theme-kit/types/theme';
import { Image } from '@usequeek/theme-kit/components/image';
import { useHref } from '@usequeek/theme-kit/hooks/use-href';

export function Blog({ posts }: BlogPageProps): JSX.Element {
  const href = useHref();

  return (
    <main className="bare-main">
      <h1 className="bare-page__title">Journal</h1>
      <ul className="bare-grid">
        {posts.map((post) => (
          <li key={post.id} className="bare-card">
            <Link href={href(`/blog/${post.slug}`)}>
              <Image src={post.cover_image_url ?? undefined} alt={post.title} className="bare-card__image" />
              <h2 className="bare-card__title">{post.title}</h2>
              {post.excerpt ? <p className="bare-card__text">{post.excerpt}</p> : null}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
