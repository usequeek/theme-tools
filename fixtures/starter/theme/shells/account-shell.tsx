'use client';

import type { JSX } from 'react';
import type { AccountShellProps } from '@usequeek/theme-kit/types/theme';

/** Core renders the flow; the shell only frames it. */
export function AccountShell({ children }: AccountShellProps): JSX.Element {
  return <div className="bare-shell">{children}</div>;
}
