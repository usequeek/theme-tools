import { Args } from '@oclif/core';
import { appApi, appFlags, requireToken } from '../../lib/app-command.js';
import { BaseCommand } from '../../lib/base-command.js';

export default class AppSubmit extends BaseCommand {
  static override summary = 'Submit the current version for review.';

  static override description = 'POSTs the existing vendor/developer/apps/{app}/submit: the version moves to in_review. There is no new endpoint — approval stays on the admin side.';

  static override examples = ['<%= config.bin %> <%= command.id %> hello'];

  static override args = {
    app: Args.string({ description: 'The app: p_id or slug (never UUID).', required: true }),
  };

  static override flags = { ...appFlags };

  async run(): Promise<{ app: string; review_status: string }> {
    const { args, flags } = await this.parse(AppSubmit);
    this.setVerbose(flags.verbose as boolean | undefined);
    const { token } = await requireToken().catch((error: Error) => this.error(error.message, { exit: 2 }));
    await appApi().submitApp(token, args.app).catch((error: Error) => this.error(error.message, { exit: 1 }));
    this.log(`Submitted ${args.app} — now in_review.`);
    return { app: args.app, review_status: 'in_review' };
  }
}
