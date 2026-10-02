export class UsageError extends Error {
  readonly exitCode = 2;
}

export class CancelledError extends Error {
  readonly exitCode = 130;
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface Flags {
  dir?: string;
  slug?: string;
  name?: string;
  pm?: string;
  install: boolean;
  git: boolean;
  yes: boolean;
  dryRun: boolean;
  force: boolean;
  /** Where the starter comes from: a giget source or a local folder. Default: the pinned starter. */
  template?: string;
}

export interface Prompter {
  /** Ask until `problem` has nothing to say about the slug: a bad slug must never end the run. */
  slug(initial: string, problem: (slug: string) => string | undefined): Promise<string>;
  /** Ask until `problem` clears the display name (single line, 1-80 chars). */
  name(initial: string, problem: (name: string) => string | undefined): Promise<string>;
}
