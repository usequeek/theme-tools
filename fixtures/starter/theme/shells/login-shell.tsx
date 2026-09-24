'use client';

import type { JSX } from 'react';
import type { LoginShellProps } from '@usequeek/theme-kit/types/theme';

/** Core renders the flow; the shell only frames it. */
export function LoginShell({ children }: LoginShellProps): JSX.Element {
  return <div className="bare-shell">{children}</div>;
}
