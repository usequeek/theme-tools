import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Flags } from '@oclif/core';
import { LoginNeededError } from '../../lib/app-api.js';
import { appFlags, appSession } from '../../lib/app-command.js';
import { assertSemver, loadApp, queekDir } from '../../lib/app-manifest.js';
import { BaseCommand } from '../../lib/base-command.js';

export default class AppDeploy extends BaseCommand {
  static override summary = 'Deploy queek.app.toml: create a version, released by default.';

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

    const result = await api
      .deploy(manifest, { version: flags.version, message: flags.message, noRelease: flags['no-release'] })
      .catch((error: Error) => this.error(error.message, { exit: 1 }));

    if (result.unchanged) {
      this.log(`No changes — version ${result.version} is current.`);
      return { slug: result.slug, version: result.version, sequence: result.sequence, status: result.status, unchanged: true };
    }
    if (flags['no-release']) {
      this.log(`Created ${result.slug} version ${result.version} (sequence ${result.sequence}) — not released. Serve it with \`queek app release ${result.slug} ${result.version}\`.`);
    } else if (result.status === 'in_review') {
      this.log(`Version ${result.version} submitted for review — it releases when approved.`);
    } else {
      this.log(`Deployed ${result.slug} version ${result.version} (sequence ${result.sequence}, ${result.review_status}).`);
    }

    if (typeof result.signing_secret === 'string' && result.signing_secret !== '') {
      const dir = queekDir(flags.path);
      mkdirSync(dir, { recursive: true });
      const envFile = join(dir, '.env.local');
      const line = `QUEEK_APP_SECRET=${result.signing_secret}\n`;
      if (existsSync(envFile) && readFileSync(envFile, 'utf8').includes('QUEEK_APP_SECRET=')) {
        this.logToStderr(`${envFile} already holds a QUEEK_APP_SECRET — the new secret is NOT written there.`);
      } else {
        appendFileSync(envFile, line, { mode: 0o600 });
        this.log(`Secret written to ${envFile} (gitignored — back it up; it is shown once).`);
      }
      this.log(`\n  App secret (shown once — copy it now):\n\n  ${result.signing_secret}\n`);
    }

    return { slug: result.slug, version: result.version, sequence: result.sequence, status: result.status, unchanged: false };
  }
}
