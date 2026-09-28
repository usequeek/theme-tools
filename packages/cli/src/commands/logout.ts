import { clearToken } from '../lib/app-auth.js';
import { BaseCommand } from '../lib/base-command.js';

export default class Logout extends BaseCommand {
  static override summary = 'Log out: forget the stored developer token.';

  static override description = 'Clears the OS keychain entry and the credentials file. A QUEEK_CLI_TOKEN env override is yours to unset — it keeps working until you do.';

  static override examples = ['<%= config.bin %> <%= command.id %>'];

  static override flags = {};

  async run(): Promise<{ cleared: string[] }> {
    await this.parse(Logout);
    const { cleared, envSet } = await clearToken();
    if (cleared.length === 0) this.log('No stored token found.');
    else this.log(`Logged out (cleared ${cleared.join(' + ')}).`);
    if (envSet) this.logToStderr('Note: QUEEK_CLI_TOKEN is still set and keeps authenticating commands.');
    return { cleared };
  }
}
