import { DeveloperApi } from '../../lib/app-api.js';
import { apiBase, clearSession, readSession } from '../../lib/app-auth.js';
import { BaseCommand } from '../../lib/base-command.js';

export default class AuthLogout extends BaseCommand {
  static override summary = 'Log out: revoke the session server-side, then forget it locally.';

  static override description = 'Revokes the stored access token via POST /oauth/revoke (the public `cli` client needs no secret), then deletes the local session. The revoke is still best-effort — local creds are always cleared. A QUEEK_APP_AUTOMATION_TOKEN env override is yours to unset — it keeps working until you do.';

  static override examples = ['<%= config.bin %> <%= command.id %>'];

  static override flags = {};

  async run(): Promise<{ cleared: string[] }> {
    await this.parse(AuthLogout);
    const found = await readSession();
    if (found) {
      const revoked = await new DeveloperApi(apiBase()).revokeToken(found.session.access_token).catch(() => false);
      if (revoked) this.log('Server session revoked.');
      else this.logToStderr('Note: the server did not confirm the revoke — the local session is still forgotten below.');
    }
    const { cleared, automationSet } = await clearSession();
    if (cleared.length === 0 && !found) this.log('No stored session found.');
    else this.log(`Logged out (cleared ${cleared.length > 0 ? cleared.join(' + ') : 'nothing stored'}).`);
    if (automationSet) this.logToStderr('Note: QUEEK_APP_AUTOMATION_TOKEN is still set and keeps authenticating commands.');
    return { cleared };
  }
}
