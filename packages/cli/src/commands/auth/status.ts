import { errorText, LoginNeededError } from '../../lib/app-api.js';
import { automationToken } from '../../lib/app-auth.js';
import { storedSessionApi } from '../../lib/app-session.js';
import { BaseCommand } from '../../lib/base-command.js';

export interface AuthStatusResult {
  signed_in: boolean;
  kind: 'automation' | 'user' | null;
  /** The developer account the app commands act as (user sessions only). */
  email: string | null;
}

export default class AuthStatus extends BaseCommand {
  static override summary = 'Show which developer account the app commands act as.';

  static override description = 'Prints the signed-in developer email (apps you deploy belong to this account), or says you are not logged in (exit 1). Never signs in by itself. Under QUEEK_APP_AUTOMATION_TOKEN it says so: that token works for its own app only and carries no email.';

  static override examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --json'];

  async run(): Promise<AuthStatusResult> {
    const { flags } = await this.parse(AuthStatus);
    this.setVerbose(flags.verbose as boolean | undefined);
    if (automationToken()) {
      this.log('Using QUEEK_APP_AUTOMATION_TOKEN: it acts for its own app only (no developer account).');
      return { signed_in: true, kind: 'automation', email: null };
    }
    const notLoggedIn = (): AuthStatusResult => {
      this.log('Not logged in (no stored session, or it would not refresh) — run `queek auth login`.');
      process.exitCode = 1;
      return { signed_in: false, kind: null, email: null };
    };
    const api = await storedSessionApi();
    if (!api) return notLoggedIn();
    let email: string | null;
    try {
      email = await api.developerEmail();
    } catch (error) {
      // A revoked session refuses its refresh: that is "not logged in", not a failure.
      if (error instanceof LoginNeededError) return notLoggedIn();
      this.error(errorText(error as Error), { exit: 1 });
    }
    this.log(email ? `Logged in as ${email}. Apps you deploy belong to this account.` : 'Logged in (this Queek API does not name the account yet).');
    return { signed_in: true, kind: 'user', email };
  }
}
