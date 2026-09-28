import { Flags } from '@oclif/core';
import { DeveloperApi } from './app-api.js';
import { apiBase, readToken } from './app-auth.js';

/**
 * What every `app` command shares: `--path` (the app project),
 * `-c/--config` (a named `queek.app.<name>.toml` variant), and the login
 * gate. Apps are addressed by `p_id|slug` only, never UUID.
 */
export const appFlags = {
  path: Flags.string({ summary: 'The app project (where queek.app.toml lives).', default: '.', env: 'QUEEK_APP_PATH' }),
  config: Flags.string({
    char: 'c',
    summary: 'A named config variant: reads queek.app.<name>.toml instead of queek.app.toml.',
    env: 'QUEEK_APP_CONFIG',
  }),
};

/** The stored token, or a login hint (exit 2) — never the token itself. */
export async function requireToken(): Promise<{ token: string; source: string }> {
  const found = await readToken();
  if (!found) {
    throw new Error('Not logged in — run `queek login` first (or set QUEEK_CLI_TOKEN).');
  }
  return found;
}

export function appApi(): DeveloperApi {
  return new DeveloperApi(apiBase());
}
