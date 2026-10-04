import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Flags } from '@oclif/core';
import { DASHBOARD_URL, LoginNeededError } from '../../lib/app-api.js';
import { appFlags, appSession } from '../../lib/app-command.js';
import { ensureQueekIgnored } from '../../lib/app-env.js';
import { assertSemver, loadApp, queekDir } from '../../lib/app-manifest.js';
import { BaseCommand } from '../../lib/base-command.js';

/**
 * The shown-once secret reaches stdout only for a human at a terminal: CI
 * logs keep everything forever, so a piped run or an automation-token
 * deploy records the file path and the host instruction, never the value.
 */
export function printSecretToStdout(): boolean {
  return process.stdout.isTTY === true && !process.env.QUEEK_APP_AUTOMATION_TOKEN;
}

/**
 * Shopify deploy parity: "New version released — <slug>-N · <message> · <link
 * to the version page>". The message segment drops out when no --message was
 * passed; the link is the one-version page (D5:
 * `/developers?app={p_id}&section=versions&version={sequence}`).
 */
export function deploySuccessLine(input: { slug: string; pId: string; sequence: number; message?: string }): string {
  const note = input.message ? ` · ${input.message}` : '';
  return `New version released — ${input.slug}-${input.sequence}${note} · ${DASHBOARD_URL}/developers?app=${input.pId}&section=versions&version=${input.sequence}`;
}

export default class AppDeploy extends BaseCommand {
  static override summary = 'Deploy queek.app.toml, including storefront embeds: create a version, released by default.';

  static override description = `Pushes the local queek.app.toml to POST vendor/developer/apps — deploy carries config (there is no config push). The toml carries no version: the backend auto-assigns the next patch unless --version names one. An identical manifest is a no-op ("No changes", exit 0). --no-release creates the version without serving it (release it later with \`queek app release\`). A version that adds a review-required capability lands in_review instead of releasing. The signing secret is shown ONCE on first registration and written to .queek/.env.local — it is never returned again. In CI, QUEEK_APP_AUTOMATION_TOKEN authenticates with no login.`;

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --version 1.2.0 --message "New greeting setting"',
    '<%= config.bin %> <%= command.id %> --no-release',
  ];

  static override flags = {
    ...appFlags,
    version: Flags.string({ summary: 'Name this version X.Y.Z (default: backend auto-assigns the next patch).' }),
    message: Flags.string({ summary: 'Release note for the new version (max 2000 chars).', env: 'QUEEK_APP_MESSAGE' }),
    'no-release': Flags.boolean({ summary: 'Create the version without releasing it.', default: false }),
  };

  async run(): Promise<{ slug: string; version: string; sequence: number; status: string; unchanged: boolean }> {
    const { flags } = await this.parse(AppDeploy);
    this.setVerbose(flags.verbose as boolean | undefined);
    if (flags.version !== undefined) {
      try {
        assertSemver(flags.version);
      } catch (error) {
        this.error((error as Error).message, { exit: 2 });
      }
    }
    const { path, manifest, warnings } = loadApp(flags.path, flags.config);
    for (const warning of warnings) this.logToStderr(`Warning: ${warning}`);
    this.debug(`toml: ${path}`);
    const { api } = await appSession({
      noBrowser: flags['no-browser'],
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(error.message, { exit: error instanceof LoginNeededError ? 2 : 1 }));

    // Server validation errors (422 whole-config refusals like
    // "[product]: requires write_products") surface verbatim: the server's
    // message passes through unwrapped, never reworded.
    const result = await api
      .deploy(manifest, { version: flags.version, message: flags.message, noRelease: flags['no-release'] })
      .catch((error: Error) => this.error(error.message, { exit: 1 }));

    // Gated by the backend's explicit-submit switch: a successful deploy
    // whose version waits in development — not a failure, exit 0.
    if (result.status === 'review_required') {
      this.log(`v${result.version} is ready for review. Run: queek app submit ${manifest.slug} --sequence ${result.sequence}`);
      this.log('Track it on the Developer page: https://dashboard.usequeek.com/developers');
      return { slug: manifest.slug, version: result.version, sequence: result.sequence, status: result.status, unchanged: false };
    }

    if (result.unchanged) {
      this.log(`No changes — version ${result.version} is current.`);
      return { slug: result.slug, version: result.version, sequence: result.sequence, status: result.status, unchanged: true };
    }
    // `created` only arrives when --no-release held the version in
    // development (default deploy always releases via the policy) — the
    // serve-it-later hint belongs to that flag alone.
    if (result.status === 'created' && flags['no-release']) {
      this.log(`Created ${result.slug} version ${result.version} (sequence ${result.sequence}) — not released. Serve it with \`queek app release ${result.slug} --version ${result.version}\`.`);
    } else if (result.status === 'created') {
      this.log(`Created ${result.slug} version ${result.version} (sequence ${result.sequence}).`);
    } else if (result.status === 'in_review') {
      this.log(`Version ${result.version} submitted for review — it releases when approved.`);
    } else {
      this.log(deploySuccessLine({ slug: result.slug, pId: result.p_id, sequence: result.sequence, message: flags.message }));
    }

    if (typeof result.signing_secret === 'string' && result.signing_secret !== '') {
      const dir = queekDir(flags.path);
      mkdirSync(dir, { recursive: true });
      ensureQueekIgnored(flags.path);
      const envFile = join(dir, '.env.local');
      const line = `QUEEK_APP_SECRET=${result.signing_secret}\n`;
      if (existsSync(envFile) && readFileSync(envFile, 'utf8').includes('QUEEK_APP_SECRET=')) {
        this.logToStderr(`${envFile} already holds a QUEEK_APP_SECRET — the new secret is NOT written there.`);
      } else {
        appendFileSync(envFile, line, { mode: 0o600 });
        try {
          chmodSync(envFile, 0o600);
        } catch {
          // Best effort (Windows has no Unix modes); the content is what matters.
        }
        this.log(`Secret written to ${envFile} (gitignored — back it up; it is shown once).`);
      }
      if (printSecretToStdout()) {
        this.log(`\n  App secret (shown once — copy it now):\n\n  ${result.signing_secret}\n`);
      } else {
        this.log(`Set it as QUEEK_APP_SECRET in your host from ${envFile} — the value is only ever printed on an interactive terminal.`);
      }
    }

    return { slug: result.slug, version: result.version, sequence: result.sequence, status: result.status, unchanged: false };
  }
}
