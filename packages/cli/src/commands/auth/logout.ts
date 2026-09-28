import { DeveloperApi } from '../../lib/app-api.js';
import { apiBase, clearSession, readSession } from '../../lib/app-auth.js';
import { BaseCommand } from '../../lib/base-command.js';

export default class AuthLogout extends BaseCommand {
  static override summary = 'Log out: revoke the session server-side when possible, then forget it locally.';

  static override description = 'Attempts POST /oauth/revoke for the stored access token (best-effort: the backend authenticates the client there, which a public CLI cannot do without an embedded secret — see the backend must-fix list), then always deletes the local session. A QUEEK_APP_AUTOMATION_TOKEN env override is yours to unset — it keeps working until you do.';

  static override examples = ['<%= config.bin %> <%= command.id %>'];

  static override flags = {};

  async run(): Promise<{ cleared: string[] }> {
    await this.parse(AuthLogout);
    const found = await readSession();
    if (found) {
      const revoked = await new DeveloperApi(apiBase()).revokeToken(found.session.access_token).catch(() => false);
      if (!revoked) this.logToStderr('Note: the server refused the revoke call (expected until secretless revoke lands) — the local session is still forgotten below.');
    }
    const { cleared, automationSet } = await clearSession();
    if (cleared.length === 0 && !found) this.log('No stored session found.');
    else this.log(`Logged out (cleared ${cleared.length > 0 ? cleared.join(' + ') : 'nothing stored'}).`);
    if (automationSet) this.logToStderr('Note: QUEEK_APP_AUTOMATION_TOKEN is still set and keeps authenticating commands.');
    return { cleared };
  }
}
