'use client';

import type { JSX } from 'react';
import Link from 'next/link';
import type { GalleryBlockData } from '@usequeek/theme-kit/types/block';
import { Image } from '@usequeek/theme-kit/components/image';
import { useHref } from '@usequeek/theme-kit/hooks/use-href';

/**
 * One image, a heading and a call to action. Every field it reads is declared
 * in manifest.ts under gallery.banner — keep the two in step and the merchant's
 * editor shows exactly the controls this renders.
 */
export function GalleryBlock({ images, heading, description }: GalleryBlockData): JSX.Element | null {
  const href = useHref();
  const slide = images?.[0];
  if (!slide) return null;

  return (
    <section className="bare-banner">
      {slide.url ? <Image src={slide.url} alt={slide.alt ?? heading ?? ''} className="bare-banner__image" /> : null}
      <div className="bare-banner__body">
        <h2 className="bare-banner__title">{slide.title ?? heading ?? ''}</h2>
        {slide.subtitle ?? description ? <p className="bare-banner__text">{slide.subtitle ?? description}</p> : null}
        {slide.cta_label ? (
          <Link className="bare-btn" href={slide.cta_url ?? href('/shop')}>{slide.cta_label}</Link>
        ) : null}
      </div>
    </section>
  );
}
