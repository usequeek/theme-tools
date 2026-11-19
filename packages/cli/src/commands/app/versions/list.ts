import { Args } from '@oclif/core';
import { cleanText, errorText, LoginNeededError } from '../../../lib/app-api.js';
import { appFlags, appSession } from '../../../lib/app-command.js';
import type { AppVersion } from '../../../lib/app-api.js';
import { BaseCommand } from '../../../lib/base-command.js';

/** One row per version (`* ` marks the serving one), its review note indented under it. */
export function versionLines(versions: Array<Pick<AppVersion, 'version' | 'sequence' | 'review_status' | 'review_note' | 'current'>>): string[] {
  return versions.flatMap((row) => [
    `${row.current ? '*' : ' '} ${row.version} (sequence ${row.sequence}, ${row.review_status})`,
    ...(row.review_note ? [`    Note: ${cleanText(row.review_note)}`] : []),
  ]);
}

export default class AppVersionsList extends BaseCommand {
  static override summary = 'List every version snapshot of an app, newest first.';

  static override description = 'Reads GET vendor/developer/apps/{app}/versions. The current (serving) version is marked with *; each row shows its review status and, under it, the reviewer\'s (or the withdraw) note. Reply to a reviewer with `queek app review reply`.';

  static override examples = ['<%= config.bin %> <%= command.id %> hello'];

  static override args = {
    app: Args.string({ description: 'The app: p_id or slug (never UUID).', required: true }),
  };

  static override flags = { ...appFlags };

  async run(): Promise<{ versions: { version: string; sequence: number; review_status: string; review_note: string | null; current: boolean }[] }> {
    const { args, flags } = await this.parse(AppVersionsList);
    this.setVerbose(flags.verbose as boolean | undefined);
    const { api } = await appSession({
      noBrowser: flags['no-browser'],
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(errorText(error), { exit: error instanceof LoginNeededError ? 2 : 1 }));
    const { versions } = await api.appVersions(args.app).catch((error: Error) => this.error(errorText(error), { exit: 1 }));

    if (versions.length === 0) this.log('No versions yet — `queek app deploy` cuts the first one.');
    for (const line of versionLines(versions)) this.log(line);
    return { versions };
  }
}
