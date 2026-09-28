import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Args, Flags } from '@oclif/core';
import { appApi, appFlags, requireToken } from '../../../lib/app-command.js';
import { fromManifest, tomlFileName } from '../../../lib/app-manifest.js';
import { BaseCommand } from '../../../lib/base-command.js';

export default class AppConfigLink extends BaseCommand {
  static override summary = 'Pull the server manifest into queek.app.toml (server → toml).';

  static override description = 'Reads GET vendor/developer/apps/{app}/config (the latest-sequence version) and writes it as grouped toml. There is deliberately no config push — deploy carries config.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> hello',
    '<%= config.bin %> <%= command.id %> hello -c staging --force',
  ];

  static override args = {
    app: Args.string({ description: 'The app: p_id or slug (never UUID).', required: true }),
  };

  static override flags = {
    ...appFlags,
    force: Flags.boolean({ summary: 'Overwrite the local toml when it already exists.', default: false }),
  };

  async run(): Promise<{ file: string }> {
    const { args, flags } = await this.parse(AppConfigLink);
    this.setVerbose(flags.verbose as boolean | undefined);
    const { token } = await requireToken().catch((error: Error) => this.error(error.message, { exit: 2 }));
    const api = appApi();

    const config = await api.appConfig(token, args.app).catch((error: Error) => this.error(error.message, { exit: 1 }));
    const target = resolve(flags.path, tomlFileName(flags.config));
    if (existsSync(target) && !flags.force) {
      this.error(`${tomlFileName(flags.config)} already exists — pass --force to overwrite it with the server manifest.`, { exit: 2 });
    }
    mkdirSync(flags.path, { recursive: true });
    writeFileSync(target, fromManifest(config.manifest));
    this.log(`Linked ${config.slug} version ${config.version} (sequence ${config.sequence}, ${config.review_status}) → ${target}`);
    return { file: target };
  }
}
