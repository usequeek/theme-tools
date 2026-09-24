'use client';

import type { JSX } from 'react';
import type { FooterProps } from '@usequeek/theme-kit/types/theme';
import { useStorefront } from '@usequeek/theme-kit/provider';
import { renderMarkdown } from '@usequeek/theme-kit/utils/markdown';
import { PoweredByQueek } from '@usequeek/theme-kit/components/powered-by-queek';

export function Footer({ heading, tagline, columns, copyright }: FooterProps): JSX.Element {
  const { vendor } = useStorefront();

  return (
    <footer className="bare-footer">
      <div className="bare-footer__intro">
        <h2>{heading ?? vendor.name}</h2>
        {tagline ? <p>{tagline}</p> : null}
      </div>

      {columns && columns.length > 0 ? (
        <div className="bare-footer__columns">
          {columns.map((column) => (
            <section key={column.heading ?? ''}>
              <h3>{column.heading}</h3>
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(column.content ?? '') }} />
            </section>
          ))}
        </div>
      ) : null}

      <p className="bare-footer__legal">{copyright ?? `© ${vendor.name}`}</p>

      <PoweredByQueek />
    </footer>
  );
}
