import { Args, Flags } from '@oclif/core';
import { errorText, LoginNeededError, type DevStore } from '../../lib/app-api.js';
import { appSession } from '../../lib/app-command.js';
import { createNewDevStore, DevStoreError } from '../../lib/app-dev-store.js';
import { BaseCommand } from '../../lib/base-command.js';

export default class DevStoreCreate extends BaseCommand {
  static override summary = 'Create a dev store with test data.';

  static override description = 'POSTs vendor/developer/dev-stores: a standalone store you own for testing apps, filled with test data in the background. The address defaults to the name plus "-dev"; a taken address is refused with a free suggestion. The storefront password is printed once, on a terminal only — it stays on the dashboard (Developers → Dev stores). Renaming happens on the dashboard.';

  static override examples = ['<%= config.bin %> <%= command.id %> "Booking demo"', '<%= config.bin %> <%= command.id %> "Booking demo" --slug booking-demo'];

  static override args = {
    name: Args.string({ description: 'The store name (max 60 characters).', required: true }),
  };

  static override flags = {
    slug: Flags.string({ summary: 'The store address (default: the name plus "-dev").' }),
  };

  async run(): Promise<{ store: DevStore }> {
    const { args, flags } = await this.parse(DevStoreCreate);
    this.setVerbose(flags.verbose as boolean | undefined);
    const { api } = await appSession({
      noBrowser: false,
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(errorText(error), { exit: error instanceof LoginNeededError ? 2 : 1 }));
    // The password line is for a person at a terminal only: a piped or CI run keeps it out of logs.
    const terminal = process.stdout.isTTY === true;
    const store = await createNewDevStore(api, args.name, flags.slug, (line) => {
      if (line.startsWith('Storefront password') && !terminal) {
        this.log('Storefront password: see the dashboard (Developers → Dev stores) — it is only printed on a terminal.');
        return;
      }
      this.log(line);
    }).catch((error: Error) => this.error(error.message, { exit: error instanceof DevStoreError ? error.exit : 1 }));
    return { store };
  }
}
