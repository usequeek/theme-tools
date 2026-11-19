import { Args } from '@oclif/core';
import { apiFailureOf, errorText, LoginNeededError } from '../../lib/app-api.js';
import { appSession } from '../../lib/app-command.js';
import { devStoreRefusal, findDevStore } from '../../lib/app-dev-store.js';
import { BaseCommand } from '../../lib/base-command.js';

export default class DevStoreTestData extends BaseCommand {
  static override summary = 'Generate (or top up) the test data of a dev store you own.';

  static override description = 'POSTs vendor/developer/dev-stores/{p_id}/test-data. Queued in the background: only missing records are created and your own edits stay, so it is safe to repeat. `queek dev-store list` shows the status; you are also notified when it is done.';

  static override examples = ['<%= config.bin %> <%= command.id %> 1259', '<%= config.bin %> <%= command.id %> my-dev-store'];

  static override args = {
    store: Args.string({ description: 'The dev store: numeric p_id, slug or name.', required: true }),
  };

  async run(): Promise<{ store: number; test_data_status: string }> {
    const { args, flags } = await this.parse(DevStoreTestData);
    this.setVerbose(flags.verbose as boolean | undefined);
    const { api } = await appSession({
      noBrowser: false,
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(errorText(error), { exit: error instanceof LoginNeededError ? 2 : 1 }));
    const { data: stores } = await api.devStores().catch((error: Error) => this.error(errorText(error), { exit: 1 }));
    const store = findDevStore(stores, args.store);
    if (!store) this.error(devStoreRefusal(args.store, stores), { exit: 2 });
    const queued = await api.seedDevStoreTestData(store.p_id).catch((error: Error) => {
      if (apiFailureOf(error)?.errorType === 'test_data_in_progress') {
        this.log(`Test data is already being generated for '${store.name}' (${store.p_id}) — nothing new queued.`);
        return { status: 'in_progress' };
      }
      this.error(errorText(error), { exit: 1 });
    });
    if (queued.status !== 'in_progress') this.log(`Test data queued for '${store.name}' (${store.p_id}). \`queek dev-store list\` shows when it is done.`);
    return { store: store.p_id, test_data_status: queued.status };
  }
}
