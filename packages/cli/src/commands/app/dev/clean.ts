import * as p from '@clack/prompts';
import { Flags } from '@oclif/core';
import { apiFailureOf, AutomationTokenError, LoginNeededError, type DeveloperApi, type DevStore } from '../../../lib/app-api.js';
import { appFlags, appSession } from '../../../lib/app-command.js';
import { DevStoreError, forgetSavedStore, readSavedStore, selectDevStore, terminalDevStorePrompts } from '../../../lib/app-dev-store.js';
import { loadApp, queekDir } from '../../../lib/app-manifest.js';
import { BaseCommand } from '../../../lib/base-command.js';

export interface CleanResult {
  app: string;
  store: { p_id: number; name: string };
  /** The dev install was removed (false: there was none). */
  removed: boolean;
  /** The saved dev store selection was forgotten (`--reset`). */
  reset: boolean;
}

/** The API has no route for removing a dev install (an older server): distinct from "no such install". */
function removalUnsupported(error: unknown): boolean {
  const failure = apiFailureOf(error);
  return failure !== null && (failure.status === 405 || (failure.status === 404 && /route .*could not be found|method .*not supported/i.test(failure.message)));
}

/**
 * Remove the app's dev install from one dev store. A missing install is a
 * clean no-op, not an error; an API that cannot remove installs yet is said
 * plainly. Prints what was removed.
 */
export async function cleanDevInstall(
  api: Pick<DeveloperApi, 'removeDevInstall'>,
  slug: string,
  store: Pick<DevStore, 'p_id' | 'name'>,
  log: (line: string) => void,
): Promise<boolean> {
  try {
    await api.removeDevInstall(slug, store.p_id);
  } catch (error) {
    if (removalUnsupported(error)) {
      throw new Error(`This Queek API cannot remove a dev install yet — uninstall '${slug}' from the admin of dev store '${store.name}' instead.`);
    }
    const failure = apiFailureOf(error);
    if (failure?.status === 404) {
      log(`Nothing to remove: '${slug}' has no dev install on dev store '${store.name}' (${store.p_id}).`);
      return false;
    }
    throw error;
  }
  log(`Removed the dev install of '${slug}' from dev store '${store.name}' (${store.p_id}).`);
  log('Data your app keeps in its own database is not touched.');
  return true;
}

export default class AppDevClean extends BaseCommand {
  static override summary = 'Remove the dev install of this app from its dev store.';

  static override description = `Uninstalls the dev build \`queek app dev\` installed from a dev store you own, and prints what was removed. The store is the one you pass with --store, else the one picked by the last \`queek app dev\` run, else your only dev store; with several you choose on a terminal (or pass --store in CI). Data your app keeps in its own database is not touched, and the dev store itself stays.

--reset also forgets the saved dev store selection, so the next \`queek app dev\` asks again. You must be signed in as a developer (queek auth login).`;

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --store 12',
    '<%= config.bin %> <%= command.id %> --reset',
  ];

  static override flags = {
    ...appFlags,
    store: Flags.string({ summary: 'The owned dev store (numeric p_id, slug or name).', env: 'QUEEK_APP_STORE' }),
    reset: Flags.boolean({ summary: 'Also forget the dev store saved by `queek app dev`.', default: false }),
  };

  async run(): Promise<CleanResult> {
    const { flags } = await this.parse(AppDevClean);
    this.setVerbose(flags.verbose as boolean | undefined);
    const { api, kind } = await appSession({
      noBrowser: flags['no-browser'],
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(error.message, { exit: error instanceof LoginNeededError ? 2 : 1 }));
    if (kind === 'automation') {
      this.error('`queek app dev clean` needs a developer session (dev-store reads are outside the automation grant) — run it where `queek auth login` works.', { exit: 2 });
    }

    const { manifest, warnings } = loadApp(flags.path, flags.config);
    for (const warning of warnings) this.logToStderr(`Warning: ${warning}`);
    const queek = queekDir(flags.path);
    const answer = <T>(value: T | symbol): T => {
      if (p.isCancel(value)) this.error('Cancelled.', { exit: 130 });
      return value as T;
    };
    const { store } = await selectDevStore(
      api,
      {
        appName: manifest.name,
        wanted: flags.store,
        create: false,
        saved: readSavedStore(queek),
        interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
        allowCreate: false,
      },
      terminalDevStorePrompts(answer),
      (line) => this.log(line),
    ).catch((error: Error) => this.error(error.message, { exit: error instanceof DevStoreError ? error.exit : 1 }));

    const removed = await cleanDevInstall(api, manifest.slug, store, (line) => this.log(line)).catch((error: Error) =>
      this.error(error.message, { exit: error instanceof AutomationTokenError ? 2 : 1 }),
    );
    let reset = false;
    if (flags.reset) {
      reset = forgetSavedStore(queek);
      this.log(reset ? 'Forgot the saved dev store selection (.queek/dev.json).' : 'No saved dev store selection to forget.');
    }
    return { app: manifest.slug, store: { p_id: store.p_id, name: store.name }, removed, reset };
  }
}
