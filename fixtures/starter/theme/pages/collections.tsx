import type { JSX } from 'react';
import Link from 'next/link';
import type { CollectionsPageProps } from '@usequeek/theme-kit/types/theme';
import { Image } from '@usequeek/theme-kit/components/image';
import { useHref } from '@usequeek/theme-kit/hooks/use-href';

export function Collections({ collections }: CollectionsPageProps): JSX.Element {
  const href = useHref();

  return (
    <main className="bare-main">
      <h1 className="bare-page__title">Collections</h1>
      <ul className="bare-grid">
        {collections.map((collection) => (
          <li key={collection.id} className="bare-card">
            <Link href={href(`/collections/${collection.slug}`)}>
              <Image src={collection.image ?? undefined} alt={collection.name} className="bare-card__image" />
              <h2 className="bare-card__title">{collection.name}</h2>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
