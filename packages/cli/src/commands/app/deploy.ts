import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Flags } from '@oclif/core';
import { LoginNeededError } from '../../lib/app-api.js';
import { appFlags, appSession } from '../../lib/app-command.js';
import { loadApp, queekDir } from '../../lib/app-manifest.js';
import { BaseCommand } from '../../lib/base-command.js';

export default class AppDeploy extends BaseCommand {
  static override summary = 'Deploy queek.app.toml: push config and cut version N+1.';

  static override description = `Pushes the local queek.app.toml to POST vendor/developer/apps ({manifest, changelog}) — deploy carries config (there is no config push). A same-version deploy of an unreleased (development) build updates in place; anything else cuts version N+1. The signing secret is shown ONCE on first registration and written to .queek/.env.local — it is never returned again. In CI, QUEEK_APP_AUTOMATION_TOKEN authenticates with no login.`;

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> -c staging --changelog "New greeting setting"',
  ];

  static override flags = {
    ...appFlags,
    changelog: Flags.string({ summary: 'Changelog for the new version (max 2000 chars).', env: 'QUEEK_APP_CHANGELOG' }),
  };

  async run(): Promise<{ slug: string; version: string; sequence: number }> {
    const { flags } = await this.parse(AppDeploy);
    this.setVerbose(flags.verbose as boolean | undefined);
    const { path, manifest } = loadApp(flags.path, flags.config);
    this.debug(`toml: ${path}`);
    const { api } = await appSession({
      noBrowser: flags['no-browser'],
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(error.message, { exit: error instanceof LoginNeededError ? 2 : 1 }));

    const result = await api.deploy(manifest, flags.changelog).catch((error: Error) => this.error(error.message, { exit: 1 }));
    this.log(`Deployed ${result.slug} version ${result.version} (sequence ${result.sequence}, ${result.review_status}).`);

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

    return { slug: result.slug, version: result.version, sequence: result.sequence };
  }
}
