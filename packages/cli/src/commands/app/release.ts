import { Args } from '@oclif/core';
import { appApi, appFlags, requireToken } from '../../lib/app-command.js';
import { BaseCommand } from '../../lib/base-command.js';

export default class AppRelease extends BaseCommand {
  static override summary = 'Serve a previous version snapshot (revert).';

  static override description = 'POSTs vendor/developer/apps/{app}/versions/{version}/release: installs keep serving the current version until the release moves the listing. Mirrors `shopify app release --version`.';

  static override examples = ['<%= config.bin %> <%= command.id %> hello 1.2.0'];

  static override args = {
    app: Args.string({ description: 'The app: p_id or slug (never UUID).', required: true }),
    version: Args.string({ description: 'The X.Y.Z version snapshot to serve.', required: true }),
  };

  static override flags = { ...appFlags };

  async run(): Promise<{ app: string; version: string }> {
    const { args, flags } = await this.parse(AppRelease);
    this.setVerbose(flags.verbose as boolean | undefined);
    const { token } = await requireToken().catch((error: Error) => this.error(error.message, { exit: 2 }));
    await appApi().releaseVersion(token, args.app, args.version).catch((error: Error) => this.error(error.message, { exit: 1 }));
    this.log(`Released ${args.app} version ${args.version} — installs now serve it.`);
    return { app: args.app, version: args.version };
  }
}
