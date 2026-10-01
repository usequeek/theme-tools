import { Args, Flags } from '@oclif/core';
import { LoginNeededError } from '../../lib/app-api.js';
import { appFlags, appSession } from '../../lib/app-command.js';
import { BaseCommand } from '../../lib/base-command.js';

export default class AppRelease extends BaseCommand {
  static override summary = 'Serve a created version (release forward, revert backward).';

  static override description = 'POSTs vendor/developer/apps/{app}/versions/{sequence}/release — the route takes the version SEQUENCE. Pass a semver and the CLI resolves it via the versions list first; pass digits to use a sequence directly. A version that adds a review-required capability (or a first public listing) lands in_review instead of releasing — it serves when approved. In CI, QUEEK_APP_AUTOMATION_TOKEN authenticates with no login.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> hello 1.2.0',
    '<%= config.bin %> <%= command.id %> hello --version 1.2.0',
    '<%= config.bin %> <%= command.id %> hello --version 3',
  ];

  static override args = {
    app: Args.string({ description: 'The app: p_id or slug (never UUID).', required: true }),
    version: Args.string({ description: 'The version to serve: an X.Y.Z semver or a sequence number (or pass --version).', required: false }),
  };

  static override flags = {
    ...appFlags,
    version: Flags.string({ summary: 'The version to serve: an X.Y.Z semver or a sequence number.' }),
  };

  async run(): Promise<{ app: string; version: string | null; sequence: number | null; status: string }> {
    const { args, flags } = await this.parse(AppRelease);
    this.setVerbose(flags.verbose as boolean | undefined);
    const version = flags.version ?? args.version;
    if (!version) this.error('Pass the version to serve: `queek app release <app> <X.Y.Z|sequence>` or `--version <X.Y.Z|sequence>`.', { exit: 2 });
    const { api } = await appSession({
      noBrowser: flags['no-browser'],
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(error.message, { exit: error instanceof LoginNeededError ? 2 : 1 }));
    const result = await api.releaseVersion(args.app, version).catch((error: Error) => this.error(error.message, { exit: 1 }));
    if (result.status === 'review_required') {
      this.log(`v${result.version} is ready for review. Run: queek app submit ${args.app} --sequence ${result.sequence}`);
      this.log('Track it on the Developer page: https://dashboard.usequeek.com/developers');
      return { app: args.app, version: result.version, sequence: result.sequence, status: result.status };
    }
    if (result.status === 'in_review') {
      this.log(`Version ${result.version} submitted for review — it releases when approved.`);
    } else {
      this.log(`Released ${args.app} version ${result.version} (sequence ${result.sequence}) — installs now serve it.`);
    }
    return { app: args.app, version: result.version, sequence: result.sequence, status: result.status };
  }
}
