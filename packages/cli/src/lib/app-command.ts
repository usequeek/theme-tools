import { Flags } from '@oclif/core';
import type { DeveloperApi } from './app-api.js';
import { loadApp } from './app-manifest.js';
import { resolveSession } from './app-session.js';

/**
 * What every `app` command shares: `--path` (the app project),
 * `-c/--config` (a named `queek.app.<name>.toml` variant), `--no-browser`
 * (device-code sign-in even when a browser could open), and authenticated
 * API access. Apps are addressed by `p_id|slug` only, never UUID.
 *
 * Auth resolves per call: `QUEEK_APP_AUTOMATION_TOKEN` (CI) is used as-is
 * with no login; otherwise the developer session signs in automatically
 * when missing (browser, device fallback when headless or --no-browser).
 */
export const appFlags = {
  path: Flags.string({ summary: 'The app project (where queek.app.toml lives).', default: '.', env: 'QUEEK_APP_PATH' }),
  config: Flags.string({
    char: 'c',
    summary: 'A named config variant: reads queek.app.<name>.toml instead of queek.app.toml.',
    env: 'QUEEK_APP_CONFIG',
  }),
  'no-browser': Flags.boolean({ summary: 'Sign in with a device code instead of opening a browser.', default: false }),
};

export interface AppContext {
  api: DeveloperApi;
  kind: 'automation' | 'user';
}

/** The authenticated API for an `app` command (signs in when needed). */
export async function appSession(options: {
  noBrowser: boolean;
  log: (line: string) => void;
  logError: (line: string) => void;
  debug: (line: string) => void;
}): Promise<AppContext> {
  return resolveSession({ noBrowser: options.noBrowser, log: options.log, logError: options.logError, debug: options.debug });
}

/** `--app` for the commands that otherwise read the app from queek.app.toml. */
export const appRefFlag = {
  app: Flags.string({ summary: 'The app: p_id or slug (never UUID). Default: the slug in queek.app.toml.', env: 'QUEEK_APP' }),
};

/** The app a command acts on: `--app` when given, else the toml's slug (which also validates the toml). */
export function appRef(flags: { app?: string; path: string; config?: string }): string {
  if (flags.app !== undefined && flags.app !== '') return flags.app;
  return loadApp(flags.path, flags.config).manifest.slug;
}
