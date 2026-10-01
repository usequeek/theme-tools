import { Flags } from '@oclif/core';
import { DeveloperApi } from '../../lib/app-api.js';
import { apiBase } from '../../lib/app-auth.js';
import { browserLogin, deviceLogin } from '../../lib/app-session.js';
import { BaseCommand } from '../../lib/base-command.js';

export default class AuthLogin extends BaseCommand {
  static override summary = 'Log in as a Queek developer (usually automatic — commands sign in when needed).';

  static override description = `Opens the browser to approve a person-scoped developer-cli session via the reused connector OAuth machinery — no pasted secrets. In a shell that cannot open a browser (SSH/CI), use --device: approve the shown code on the verification page instead. CI uses QUEEK_APP_AUTOMATION_TOKEN and never logs in.`;

  static override examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --device'];

  static override flags = {
    device: Flags.boolean({ summary: 'Use the headless device-code flow instead of opening a browser.', default: false }),
  };

  async run(): Promise<{ stored: string }> {
    const { flags } = await this.parse(AuthLogin);
    this.setVerbose(flags.verbose as boolean | undefined);
    const base = apiBase();
    const api = new DeveloperApi(base);
    this.debug(`api base: ${base}`);
    const io = {
      log: (line: string) => this.log(line),
      logError: (line: string) => this.logToStderr(line),
      debug: (line: string) => this.debug(line),
    };

    const useDevice = flags.device || !process.stdin.isTTY;
    if (useDevice) return { stored: await deviceLogin(api, io) };

    try {
      return { stored: await browserLogin(api, base, io) };
    } catch (error) {
      this.logToStderr(`Browser login did not complete (${(error as Error).message}); falling back to --device.`);
      return { stored: await deviceLogin(api, io) };
    }
  }
}
