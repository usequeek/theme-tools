'use client';

import type { JSX } from 'react';
import { Link } from '@usequeek/theme-kit/navigation';
import type { CategoriesBlockProps } from '@usequeek/theme-kit/types/theme';
import { Image } from '@usequeek/theme-kit/components/image';
import { useCategories } from '@usequeek/theme-kit/hooks/use-categories';
import { useHref } from '@usequeek/theme-kit/hooks/use-href';

export function CategoriesBlock({ categories: initial, limit, title }: CategoriesBlockProps): JSX.Element | null {
  const href = useHref();
  const hasInitial = Array.isArray(initial) && initial.length > 0;
  const { categories: fetched, isLoading } = useCategories(hasInitial ? undefined : { limit });
  const categories = hasInitial ? initial : fetched;

  if (!isLoading && (!categories || categories.length === 0)) return null;

  return (
    <section className="bare-section" aria-busy={isLoading || undefined}>
      <h2 className="bare-section__title">{title ?? 'Categories'}</h2>
      <ul className="bare-grid">
        {(categories ?? []).map((category) => (
          <li className="bare-card" key={category.id}>
            <Link href={href(`/collections/${category.slug}`)}>
              <Image src={category.image ?? undefined} alt={category.name} className="bare-card__image" />
              <h3 className="bare-card__title">{category.name}</h3>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
