import { Args } from '@oclif/core';
import { LoginNeededError } from '../../../lib/app-api.js';
import { appFlags, appSession } from '../../../lib/app-command.js';
import { BaseCommand } from '../../../lib/base-command.js';

export default class AppVersionsList extends BaseCommand {
  static override summary = 'List every version snapshot of an app, newest first.';

  static override description = 'Reads GET vendor/developer/apps/{app}/versions. The current (serving) version is marked with *.';

  static override examples = ['<%= config.bin %> <%= command.id %> hello'];

  static override args = {
    app: Args.string({ description: 'The app: p_id or slug (never UUID).', required: true }),
  };

  static override flags = { ...appFlags };

  async run(): Promise<{ versions: { version: string; sequence: number; review_status: string; current: boolean }[] }> {
    const { args, flags } = await this.parse(AppVersionsList);
    this.setVerbose(flags.verbose as boolean | undefined);
    const { api } = await appSession({
      noBrowser: flags['no-browser'],
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(error.message, { exit: error instanceof LoginNeededError ? 2 : 1 }));
    const { versions } = await api.appVersions(args.app).catch((error: Error) => this.error(error.message, { exit: 1 }));

    if (versions.length === 0) this.log('No versions yet — `queek app deploy` cuts the first one.');
    for (const version of versions) {
      this.log(`${version.current ? '*' : ' '} ${version.version} (sequence ${version.sequence}, ${version.review_status})`);
    }
    return { versions };
  }
}
