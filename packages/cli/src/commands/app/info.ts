import { Flags } from '@oclif/core';
import { LoginNeededError } from '../../lib/app-api.js';
import { appFlags, appSession } from '../../lib/app-command.js';
import { loadApp, resolveTomlPath } from '../../lib/app-manifest.js';
import { BaseCommand } from '../../lib/base-command.js';
import { devStoreRefusal } from './dev.js';

export interface InfoFacts {
  file: string;
  name: string;
  slug: string;
  appId: string;
  scopes: string[];
  store: string | null;
  user: 'developer session' | 'automation token (CI)';
}

/**
 * The CURRENT APP CONFIGURATION box (Shopify `app info` parity): config
 * file, app, app ID, scopes, dev store, user. Pure for tests — run() only
 * gathers the facts.
 */
export function infoLines(facts: InfoFacts): string[] {
  return [
    `Config file: ${facts.file}`,
    `App: ${facts.name} (${facts.slug})`,
    `App ID: ${facts.appId}`,
    `Scopes: ${facts.scopes.join(', ')}`,
    `Dev store: ${facts.store ?? 'Not yet configured (pass --store)'}`,
    `User: ${facts.user}`,
  ];
}

/** Server scopes win (config-link source of truth); the local toml stands in when the server sends none. */
export function infoScopes(serverManifest: Record<string, unknown>, local: string[]): string[] {
  const served = serverManifest.scopes;
  if (Array.isArray(served) && served.every((scope): scope is string => typeof scope === 'string') && served.length > 0) return served;
  return local;
}

export default class AppInfo extends BaseCommand {
  static override summary = 'Show the current app configuration (config file, app, app ID, scopes, dev store, user).';

  static override description = 'Reads queek.app.toml plus GET vendor/developer/apps/{app}/config and prints the CURRENT APP CONFIGURATION box. --store resolves against your dev stores. To change these, run `queek app config link` (server → toml), or edit the toml and `queek app deploy`.';

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --store 12',
  ];

  static override flags = {
    ...appFlags,
    store: Flags.string({ summary: 'The owned dev store (numeric p_id, slug or name). “Not yet configured” when absent.', env: 'QUEEK_APP_STORE' }),
  };

  async run(): Promise<InfoFacts> {
    const { flags } = await this.parse(AppInfo);
    this.setVerbose(flags.verbose as boolean | undefined);
    const { manifest, warnings } = loadApp(flags.path, flags.config);
    for (const warning of warnings) this.logToStderr(`Warning: ${warning}`);
    const { api, kind } = await appSession({
      noBrowser: flags['no-browser'],
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(error.message, { exit: error instanceof LoginNeededError ? 2 : 1 }));

    const config = await api.appConfig(manifest.slug).catch((error: Error) => this.error(error.message, { exit: 1 }));
    let store: string | null = null;
    if (flags.store) {
      const { data: stores } = await api.devStores().catch((error: Error) => this.error(error.message, { exit: 1 }));
      const found = stores.find((row) => String(row.p_id) === flags.store || row.name === flags.store || row.slug === flags.store);
      if (!found) this.error(devStoreRefusal(flags.store, stores), { exit: 2 });
      store = found.name;
    }
    const facts: InfoFacts = {
      file: resolveTomlPath(flags.path, flags.config),
      name: manifest.name,
      slug: manifest.slug,
      appId: config.p_id,
      scopes: infoScopes(config.manifest, manifest.scopes),
      store,
      user: kind === 'automation' ? 'automation token (CI)' : 'developer session',
    };
    for (const line of infoLines(facts)) this.log(line);
    this.log('To change these, run `queek app config link` (server → toml), or edit the toml and `queek app deploy`.');
    return facts;
  }
}
