import { Args } from '@oclif/core';
import { LoginNeededError } from '../../lib/app-api.js';
import { appFlags, appSession } from '../../lib/app-command.js';
import { BaseCommand } from '../../lib/base-command.js';

export default class AppSubmit extends BaseCommand {
  static override summary = 'Submit the current version for review.';

  static override description = 'POSTs vendor/developer/apps/{app}/submit: development or rejected → in_review on the app and its latest unreleased version. The served listing does not move — approval is the admin side. In CI, QUEEK_APP_AUTOMATION_TOKEN authenticates with no login.';

  static override examples = ['<%= config.bin %> <%= command.id %> hello'];

  static override args = {
    app: Args.string({ description: 'The app: p_id or slug (never UUID).', required: true }),
  };

  static override flags = { ...appFlags };

  async run(): Promise<{ app: string; review_status: string; version: string | null }> {
    const { args, flags } = await this.parse(AppSubmit);
    this.setVerbose(flags.verbose as boolean | undefined);
    const { api } = await appSession({
      noBrowser: flags['no-browser'],
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(error.message, { exit: error instanceof LoginNeededError ? 2 : 1 }));
    const result = await api.submitApp(args.app).catch((error: Error) => this.error(error.message, { exit: 1 }));
    this.log(`Submitted ${args.app}${result.version ? ` version ${result.version}` : ''} — now ${result.review_status}.`);
    return { app: args.app, review_status: result.review_status, version: result.version };
  }
}
