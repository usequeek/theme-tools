'use client';

import type { JSX } from 'react';
import type { SignupShellProps } from '@usequeek/theme-kit/types/theme';

/** Core renders the flow; the shell only frames it. */
export function SignupShell({ children }: SignupShellProps): JSX.Element {
  return <div className="bare-shell">{children}</div>;
}
