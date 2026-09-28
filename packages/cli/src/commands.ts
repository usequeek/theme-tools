import type { Command } from '@oclif/core';
import { THEME_COMMANDS } from '@usequeek/theme-cli/commands';

/**
 * The theme commands, mapped under the `theme` topic — `queek theme dev`,
 * `queek theme check`, and the rest. This package holds no command code; the
 * implementations live in `@usequeek/theme-cli` (our `@shopify/theme`), the
 * way Shopify's CLI bundles its theme commands.
 *
 * (The annotation keeps `tsc` declaration emit portable: without it the
 * inferred type would name `@usequeek/theme-cli`'s dist files directly.)
 */
export const COMMANDS: Record<string, typeof Command> = Object.fromEntries(
  Object.entries(THEME_COMMANDS).map(([id, command]) => [`theme:${id}`, command]),
);
