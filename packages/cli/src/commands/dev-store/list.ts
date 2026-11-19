import { errorText, LoginNeededError, type DevStore } from '../../lib/app-api.js';
import { appSession } from '../../lib/app-command.js';
import { BaseCommand } from '../../lib/base-command.js';
import { devStoreLines } from './shared.js';

export default class DevStoreList extends BaseCommand {
  static override summary = 'List the dev stores you own or staff.';

  static override description = 'Reads GET vendor/developer/dev-stores (every page). Each row: p_id, name, slug, test data status, storefront URL. Pass the p_id to `queek app install --store` or `queek app dev --store`. Storefront passwords are never printed here.';

  static override examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --json'];

  async run(): Promise<{ stores: DevStore[] }> {
    const { flags } = await this.parse(DevStoreList);
    this.setVerbose(flags.verbose as boolean | undefined);
    const { api } = await appSession({
      noBrowser: false,
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(errorText(error), { exit: error instanceof LoginNeededError ? 2 : 1 }));
    const { data } = await api.devStores().catch((error: Error) => this.error(errorText(error), { exit: 1 }));
    for (const line of devStoreLines(data)) this.log(line);
    return { stores: data };
  }
}
