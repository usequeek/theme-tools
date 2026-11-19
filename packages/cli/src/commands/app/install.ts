import { Flags } from '@oclif/core';
import { AutomationTokenError, errorText, LoginNeededError } from '../../lib/app-api.js';
import { appFlags, appRef, appRefFlag, appSession } from '../../lib/app-command.js';
import { devStoreRefusal, findDevStore } from '../../lib/app-dev-store.js';
import { BaseCommand } from '../../lib/base-command.js';

export interface InstallResult {
  app: string;
  store: { p_id: number; name: string };
  installed_version: string;
  status: string;
  preview_url: string | null;
}

export default class AppInstall extends BaseCommand {
  static override summary = 'Install the deployed app on one of your dev stores (its latest development build).';

  static override description = `POSTs vendor/developer/apps/{app}/dev-installs: installs the latest deployed version — released or not — on a dev store you own, the same install \`queek app dev\` makes, but against the app's hosted URLs (no tunnel). Running it again refreshes the install in place. Dev stores only: merchant stores install from the App Store. The app is the slug in queek.app.toml unless --app names one.`;

  static override examples = ['<%= config.bin %> <%= command.id %> --store 1259', '<%= config.bin %> <%= command.id %> --app hello --store my-dev-store'];

  static override flags = {
    ...appFlags,
    ...appRefFlag,
    store: Flags.string({ summary: 'The dev store you own: numeric p_id, slug or name.', required: true, env: 'QUEEK_APP_STORE' }),
  };

  async run(): Promise<InstallResult> {
    const { flags } = await this.parse(AppInstall);
    this.setVerbose(flags.verbose as boolean | undefined);
    let app: string;
    try {
      app = appRef(flags);
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }
    const { api } = await appSession({
      noBrowser: flags['no-browser'],
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(errorText(error), { exit: error instanceof LoginNeededError ? 2 : 1 }));

    const { data: stores } = await api.devStores().catch((error: Error) => {
      if (error instanceof AutomationTokenError) {
        this.error('Installing on a dev store needs a developer session — automation tokens cannot. Run where `queek auth login` works.', { exit: 2 });
      }
      this.error(errorText(error), { exit: 1 });
    });
    const store = findDevStore(stores, flags.store);
    if (!store) this.error(devStoreRefusal(flags.store, stores), { exit: 2 });

    const installed = await api.devInstall(app, store.p_id).catch((error: Error) => this.error(errorText(error), { exit: 1 }));
    const preview = installed.preview_url ?? null;
    this.log(`Installed '${app}' v${installed.installed_version} on dev store '${store.name}' (${store.p_id}) — ${installed.status}.`);
    if (preview) this.log(`Open it: ${preview}`);
    return { app, store: { p_id: store.p_id, name: store.name }, installed_version: installed.installed_version, status: installed.status, preview_url: preview };
  }
}
