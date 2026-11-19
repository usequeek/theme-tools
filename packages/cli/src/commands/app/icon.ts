import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { Args } from '@oclif/core';
import { errorText, LoginNeededError } from '../../lib/app-api.js';
import { appFlags, appRef, appRefFlag, appSession } from '../../lib/app-command.js';
import { BaseCommand } from '../../lib/base-command.js';

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

/**
 * The upload's content type from its extension. Anything else is sent as
 * octet-stream and the server's own sentence explains the refusal — the
 * CLI never re-checks size, format or dimensions (the server owns them).
 */
export function iconContentType(file: string): string {
  return TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
}

export default class AppIcon extends BaseCommand {
  static override summary = "Upload the app's listing icon (required before submitting for review).";

  static override description = `POSTs the file to vendor/developer/apps/{app}/icon. The server's rules apply and its message is printed as-is when it refuses one: a square 512x512 PNG, JPG or WebP of at most 15 KB, not animated. Replacing the icon never re-opens review. The app is the slug in queek.app.toml unless --app names one.`;

  static override examples = ['<%= config.bin %> <%= command.id %> ./icon.png', '<%= config.bin %> <%= command.id %> ./icon.webp --app hello'];

  static override args = {
    file: Args.string({ description: 'The icon file (PNG, JPG or WebP).', required: true }),
  };

  static override flags = { ...appFlags, ...appRefFlag };

  async run(): Promise<{ app: string; icon_url: string | null }> {
    const { args, flags } = await this.parse(AppIcon);
    this.setVerbose(flags.verbose as boolean | undefined);
    let bytes: Buffer;
    try {
      bytes = readFileSync(args.file);
    } catch (error) {
      this.error(`Cannot read ${args.file}: ${(error as Error).message}`, { exit: 2 });
    }
    let app: string;
    try {
      app = appRef(flags);
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }
    const { api } = await appSession({
      noBrowser: flags['no-browser'],
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(errorText(error), { exit: error instanceof LoginNeededError ? 2 : 1 }));
    const uploaded = await api
      .uploadIcon(app, { bytes: new Uint8Array(bytes), name: basename(args.file), type: iconContentType(args.file) })
      .catch((error: Error) => this.error(errorText(error), { exit: 1 }));
    this.log(`Icon uploaded for '${app}'.${uploaded.iconUrl ? ` ${uploaded.iconUrl}` : ''}`);
    return { app, icon_url: uploaded.iconUrl };
  }
}
