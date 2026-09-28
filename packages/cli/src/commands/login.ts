import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { Flags } from '@oclif/core';
import { DeveloperApi } from '../lib/app-api.js';
import { apiBase, dashboardUrl, writeToken } from '../lib/app-auth.js';
import { openUrl } from '../lib/app-browser.js';
import { BaseCommand } from '../lib/base-command.js';

const base64url = (buffer: Buffer): string =>
  buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Wait for the loopback `?code=` redirect the dashboard sends back. */
function waitForCode(port: number, timeoutMs: number): Promise<{ code: string; redirectUri: string }> {
  const redirectUri = `http://127.0.0.1:${port}/callback`;
  return new Promise((resolve, reject) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', redirectUri);
      if (url.pathname !== '/callback') {
        response.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');
      response.writeHead(200, { 'content-type': 'text/html' }).end(
        '<html><body><p>You are logged in — return to the terminal.</p></body></html>',
      );
      server.close();
      if (typeof code === 'string' && code !== '') resolve({ code, redirectUri });
      else reject(new Error(error ? `The dashboard refused the login (${error}).` : 'The dashboard sent back no code.'));
    });
    server.on('error', reject);
    server.listen(port, '127.0.0.1');
    setTimeout(() => {
      server.close();
      reject(new Error('Timed out waiting for the dashboard approval (5 minutes).'));
    }, timeoutMs).unref();
  });
}

export default class Login extends BaseCommand {
  static override summary = 'Log in as a Queek developer (browser OAuth; device code when headless).';

  static override description = `Opens the dashboard, which approves a person-scoped developer-cli token via the reused connector OAuth machinery — no pasted secrets. In a shell that cannot open a browser (SSH/CI), use --device: the dashboard approves the shown code instead. The token lives in the OS keychain when keytar is installed, otherwise a 0600 file; QUEEK_CLI_TOKEN overrides both.`;

  static override examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --device'];

  static override flags = {
    device: Flags.boolean({ summary: 'Use the headless device-code flow instead of opening a browser.', default: false }),
  };

  async run(): Promise<{ stored: string }> {
    const { flags } = await this.parse(Login);
    this.setVerbose(flags.verbose as boolean | undefined);
    const base = apiBase();
    const api = new DeveloperApi(base);
    this.debug(`api base: ${base}`);

    const useDevice = flags.device || !process.stdin.isTTY;
    if (useDevice) return this.deviceLogin(api);

    try {
      return await this.browserLogin(api);
    } catch (error) {
      // A browser that cannot open is not a failed login — fall through to
      // the headless flow rather than stranding SSH users.
      this.logToStderr(`Browser login did not complete (${(error as Error).message}); falling back to --device.`);
      return this.deviceLogin(api);
    }
  }

  private async browserLogin(api: DeveloperApi): Promise<{ stored: string }> {
    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash('sha256').update(verifier).digest());
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.on('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      server.close();
      throw new Error('Could not bind the loopback login redirect.');
    }
    server.close();
    const redirectUri = `http://127.0.0.1:${(address as { port: number }).port}/callback`;
    const authorize = new URL(`${dashboardUrl()}/oauth/authorize`);
    authorize.searchParams.set('client_id', 'cli');
    authorize.searchParams.set('redirect_uri', redirectUri);
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('scope', 'developer-cli');
    authorize.searchParams.set('code_challenge', challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');

    this.log('Opening the dashboard to approve this login…');
    openUrl(authorize.toString());
    const { code } = await waitForCode((address as { port: number }).port, 5 * 60_000);
    const { token } = await api.oauthToken({ code, code_verifier: verifier, redirect_uri: redirectUri });
    const stored = await writeToken(token);
    this.log(`Logged in (token stored in ${stored === 'keychain' ? 'the OS keychain' : 'a 0600 credentials file'}).`);
    return { stored };
  }

  private async deviceLogin(api: DeveloperApi): Promise<{ stored: string }> {
    const issued = await api.deviceCode().catch((error: Error) => this.error(error.message, { exit: 2 }));
    this.log(`Open ${issued.verify_url} and enter code:\n\n  ${issued.code}\n`);
    const deadline = Date.now() + issued.expires_in * 1000;
    for (;;) {
      await new Promise((done) => setTimeout(done, 5_000));
      const approved = await api.deviceStatus(issued.code).catch((error: Error & { status?: number }) => {
        // A wrong/expired code reads as 404 — that ends the wait, anything
        // else is transient and the poll continues.
        if ((error as { status?: number }).status === 404) this.error('That code is unknown or expired — run `queek login --device` again.', { exit: 2 });
        this.debug(`device poll: ${error.message}`);
        return null;
      });
      if (approved) {
        const stored = await writeToken(approved.token);
        this.log(`Logged in (token stored in ${stored === 'keychain' ? 'the OS keychain' : 'a 0600 credentials file'}).`);
        return { stored };
      }
      if (Date.now() > deadline) this.error('The code expired before approval — run `queek login --device` again.', { exit: 2 });
    }
  }
}
