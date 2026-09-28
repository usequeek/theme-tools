import { Args } from '@oclif/core';
import { LoginNeededError } from '../../lib/app-api.js';
import { appFlags, appSession } from '../../lib/app-command.js';
import { BaseCommand } from '../../lib/base-command.js';

export default class AppRelease extends BaseCommand {
  static override summary = 'Serve an approved version snapshot (release forward, revert backward).';

  static override description = 'POSTs vendor/developer/apps/{app}/versions/{version}/release. Unapproved versions refuse 422 — every version ships through review first. In CI, QUEEK_APP_AUTOMATION_TOKEN authenticates with no login.';

  static override examples = ['<%= config.bin %> <%= command.id %> hello 1.2.0'];

  static override args = {
    app: Args.string({ description: 'The app: p_id or slug (never UUID).', required: true }),
    version: Args.string({ description: 'The X.Y.Z version snapshot to serve.', required: true }),
  };

  static override flags = { ...appFlags };

  async run(): Promise<{ app: string; version: string }> {
    const { args, flags } = await this.parse(AppRelease);
    this.setVerbose(flags.verbose as boolean | undefined);
    const { api } = await appSession({
      noBrowser: flags['no-browser'],
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(error.message, { exit: error instanceof LoginNeededError ? 2 : 1 }));
    await api.releaseVersion(args.app, args.version).catch((error: Error) => this.error(error.message, { exit: 1 }));
    this.log(`Released ${args.app} version ${args.version} — installs now serve it.`);
    return { app: args.app, version: args.version };
  }
}
