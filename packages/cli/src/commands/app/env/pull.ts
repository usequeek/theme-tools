import { AutomationTokenError, errorText, LoginNeededError } from '../../../lib/app-api.js';
import { appFlags, appRef, appRefFlag, appSession } from '../../../lib/app-command.js';
import { ensureDevSecrets, ensureQueekIgnored, envLocalPath, MissingSecretError, readEnvFile, resolveDevSecret, writeEnvLocal } from '../../../lib/app-env.js';
import { loadApp, queekDir, resolveTomlPath } from '../../../lib/app-manifest.js';
import { existsSync } from 'node:fs';
import { BaseCommand } from '../../../lib/base-command.js';

export interface EnvPullResult {
  app: string;
  file: string;
  /** Every key the file now holds for the app (names only — values are never printed). */
  keys: string[];
  /** The keys this run created (a fetched secret, a new keypair, a new encryption key). */
  added: string[];
}

export default class AppEnvPull extends BaseCommand {
  static override summary = "Write the app's credentials into .queek/.env.local (values are never printed).";

  static override description = `Fills .queek/.env.local (gitignored, 0600) with what the app needs to run: QUEEK_APP_SECRET (the owner's re-view of the signing secret), APP_KEY_ID + APP_PRIVATE_KEY (a new keypair when the file has none — an app holds at most 3 keys) and APP_ENCRYPTION_KEY (generated locally). Values already in the file are kept. Never rotates or revokes anything: development and production share one app record, so those stay on the dashboard. Needs a developer session (automation tokens cannot read the secret). The app is the slug in queek.app.toml unless --app names one.`;

  static override examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --app hello'];

  static override flags = { ...appFlags, ...appRefFlag };

  async run(): Promise<EnvPullResult> {
    const { flags } = await this.parse(AppEnvPull);
    this.setVerbose(flags.verbose as boolean | undefined);
    let app: string;
    try {
      app = appRef(flags);
      // .queek/.env.local belongs to the project's own app: another app's credentials never go into it.
      if (flags.app !== undefined && existsSync(resolveTomlPath(flags.path, flags.config))) {
        const own = loadApp(flags.path, flags.config).manifest.slug;
        if (own !== app) throw new Error(`This project is '${own}' (queek.app.toml): its .queek/.env.local holds that app's credentials, not '${app}'s. Run it from '${app}'s project, or drop --app.`);
      }
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }
    const { api, kind } = await appSession({
      noBrowser: flags['no-browser'],
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(errorText(error), { exit: error instanceof LoginNeededError ? 2 : 1 }));
    if (kind === 'automation') {
      this.error('`queek app env pull` needs a developer session — automation tokens cannot read the signing secret. Set the values in your CI host instead.', { exit: 2 });
    }

    const queek = queekDir(flags.path);
    const file = envLocalPath(queek);
    const before = readEnvFile(file);
    ensureQueekIgnored(flags.path);
    try {
      // The process environment is ignored on purpose: pull writes the file.
      await resolveDevSecret(api, app, queek, before, undefined, (line) => this.log(line));
      const kids = (await api.appKeys(app)).kids;
      const { values } = await ensureDevSecrets(api, app, readEnvFile(file), kids, (line) => this.log(line));
      writeEnvLocal(queek, values);
    } catch (error) {
      if (error instanceof MissingSecretError) this.error(error.message, { exit: 2 });
      if (error instanceof AutomationTokenError) this.error(errorText(error), { exit: 2 });
      this.error(errorText(error as Error), { exit: 1 });
    }
    const after = readEnvFile(file);
    const keys = Object.keys(after);
    const added = keys.filter((key) => before[key] === undefined || before[key] === '');
    this.log(added.length > 0 ? `Wrote ${added.join(', ')} to ${file} (0600, gitignored — values are never printed).` : `${file} already holds every credential — nothing changed.`);
    return { app, file, keys, added };
  }
}
