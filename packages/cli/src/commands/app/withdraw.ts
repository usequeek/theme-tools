import { Args, Flags } from '@oclif/core';
import * as p from '@clack/prompts';
import { LoginNeededError } from '../../lib/app-api.js';
import { appFlags, appSession } from '../../lib/app-command.js';
import { latestSequence } from '../../lib/app-submit.js';
import { BaseCommand } from '../../lib/base-command.js';

export default class AppWithdraw extends BaseCommand {
  static override summary = 'Withdraw a version from review (back to development).';

  static override description = `POSTs vendor/developer/apps/{app}/versions/{sequence}/withdraw: in_review back to development with the server-written note, reviewers notified. --sequence defaults to the latest deployed version. In CI, QUEEK_APP_AUTOMATION_TOKEN authenticates with no login.`;

  static override examples = [
    '<%= config.bin %> <%= command.id %> hello',
    '<%= config.bin %> <%= command.id %> hello --sequence 3 --yes',
  ];

  static override args = {
    app: Args.string({ description: 'The app: p_id or slug (never UUID).', required: true }),
  };

  static override flags = {
    ...appFlags,
    sequence: Flags.integer({ summary: 'The version sequence to withdraw (default: latest deployed).', min: 1 }),
    yes: Flags.boolean({ summary: 'Withdraw without asking (non-interactive).', default: false, char: 'y' }),
  };

  async run(): Promise<{ app: string; version: string; sequence: number }> {
    const { args, flags } = await this.parse(AppWithdraw);
    this.setVerbose(flags.verbose as boolean | undefined);
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const { api } = await appSession({
      noBrowser: flags['no-browser'],
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(error.message, { exit: error instanceof LoginNeededError ? 2 : 1 }));

    let sequence = flags.sequence;
    if (sequence === undefined) {
      const { versions } = await api.appVersions(args.app).catch((error: Error) => this.error(error.message, { exit: 1 }));
      const latest = latestSequence(versions);
      if (latest === null) this.error(`'${args.app}' has no versions yet — nothing to withdraw.`, { exit: 1 });
      sequence = latest;
    }
    if (!flags.yes) {
      if (!interactive) this.error('Withdrawing needs confirmation — pass --yes in CI.', { exit: 2 });
      const confirmed = await p.confirm({ message: `Withdraw sequence ${sequence} of '${args.app}' from review (back to development)?` });
      if (p.isCancel(confirmed) || !confirmed) this.error('Cancelled.', { exit: 130 });
    }
    const withdrawn = await api.withdrawVersion(args.app, sequence).catch((error: Error) => this.error(error.message, { exit: 1 }));
    this.log(`Withdrew v${withdrawn.version} (sequence ${withdrawn.sequence}) — back to development.${withdrawn.review_note ? ` Note: ${withdrawn.review_note}` : ''}`);
    return { app: args.app, version: withdrawn.version, sequence: withdrawn.sequence };
  }
}
