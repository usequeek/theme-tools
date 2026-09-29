import { mkdirSync, watch } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { Flags } from '@oclif/core';
import { LoginNeededError, type DeveloperApi } from '../../lib/app-api.js';
import { apiBase } from '../../lib/app-auth.js';
import { appFlags, appSession } from '../../lib/app-command.js';
import { DEFAULT_DEV_PORT, loadApp, queekDir, resolveTomlPath, type AppManifest, type DevTable } from '../../lib/app-manifest.js';
import { ensureDevSecrets, envLocalPath, MissingSecretError, readEnvFile, resolveDevSecret, writeEnvLocal } from '../../lib/app-env.js';
import { startSupervised, waitForHealthy } from '../../lib/app-run.js';
import { manualTunnel, startCloudflared, type Tunnel } from '../../lib/app-tunnel.js';
import { BaseCommand } from '../../lib/base-command.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Point the manifest at the tunnel: every https URL leaf anywhere in the
 * manifest (dashboard notify_url/link_url/image.url, extension block
 * link_url/image.url, proxy, …) whose origin is the app's production origin
 * moves to the tunnel origin, paths kept. Off-origin URLs (a CDN logo, the
 * docs site) are left alone — rewriting those would break them, not dev.
 */
export function withDevUrls(manifest: AppManifest, tunnelUrl: string): AppManifest {
  const tunnel = new URL(tunnelUrl);
  const production = new URL(manifest.install_url).origin;
  const swapLeaf = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.origin !== production) return value;
      url.protocol = tunnel.protocol;
      url.host = tunnel.host;
      return url.toString();
    } catch {
      return value;
    }
  };
  const deep = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(deep);
    if (isRecord(node)) {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(node)) out[key] = deep(entry);
      return out;
    }
    return swapLeaf(node);
  };
  return { ...(deep(manifest) as AppManifest), distribution: 'development' };
}

export default class AppDev extends BaseCommand {
  // A long-running watcher has no result to print.
  static override enableJsonFlag = false;

  static override summary = 'Develop an app end to end: tunnel + dev install + your app running with injected env.';

  static override description = `Brings up a tunnel, registers the toml as a development build (same-semver unreleased rides the in-place rule — no version spam), installs it on an owned test store, then starts the app from the toml's CLI-only \`[dev]\` table (\`command\`, e.g. "tsx watch src/index.ts") with the dev env injected (APP_BASE_URL=<tunnel origin>, PORT, NODE_ENV=development, QUEEK_API_BASE, plus the signing secret / keypair / encryption key from .queek/.env.local, minted on first run). The app's stdout streams prefixed with [app]; a crash restarts it with backoff. Saves to queek.app.toml re-register; \`[dev]\` changes need a restart. Automation tokens cannot run dev (test-store reads are outside their grant) — sign in as a developer. Ctrl+C stops the app and the tunnel.`;

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --store 12',
    '<%= config.bin %> <%= command.id %> --url https://my-tunnel.trycloudflare.com',
  ];

  static override flags = {
    ...appFlags,
    store: Flags.string({ summary: 'The owned test store (numeric p_id or name). The only store when you own exactly one.', env: 'QUEEK_APP_STORE' }),
    port: Flags.integer({ summary: 'Your local app server port the tunnel forwards to (default: [dev].port, else 3000).', min: 1, max: 65535 }),
    url: Flags.string({ summary: 'Your own tunnel URL (https). Skips starting cloudflared.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AppDev);
    this.setVerbose(flags.verbose as boolean | undefined);
    const { api, kind } = await appSession({
      noBrowser: flags['no-browser'],
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
      debug: (line) => this.debug(line),
    }).catch((error: Error) => this.error(error.message, { exit: error instanceof LoginNeededError ? 2 : 1 }));
    if (kind === 'automation') {
      this.error('`queek app dev` needs a developer session (test-store reads are outside the automation grant) — run it where `queek auth login` works.', { exit: 2 });
    }

    const first = loadApp(flags.path, flags.config);
    for (const warning of first.warnings) this.logToStderr(`Warning: ${warning}`);
    const dev: DevTable | undefined = first.dev;
    if (!dev) {
      this.error('`queek app dev` starts the app from the toml’s [dev] table — add `[dev]` with `command = "tsx watch src/index.ts"` (and optionally `port = 3000`) to queek.app.toml.', { exit: 2 });
    }
    const port = flags.port ?? dev.port ?? DEFAULT_DEV_PORT;

    // The signing secret is never minted or rotated here — dev and
    // production share one app record, so rotating would break every live
    // install. When it is nowhere to be found, the owner's re-view fetches
    // it back over this developer session (automation never reaches here:
    // the kind gate above kept its error); only a failed fetch stops the
    // run before starting anything (tunnel included).
    const queek = queekDir(flags.path);
    mkdirSync(queek, { recursive: true });
    const recorded = readEnvFile(envLocalPath(queek));
    await resolveDevSecret(api, first.manifest.slug, queek, recorded, process.env.QUEEK_APP_SECRET, (line) => this.log(line)).catch(
      (error: Error) => this.error(error.message, { exit: error instanceof MissingSecretError ? 2 : 1 }),
    );

    const tomlPath = resolveTomlPath(flags.path, flags.config);
    const tunnel = await this.tunnel(flags.path, flags.url, port);
    const app = await this.startApp(api, flags.path, first.manifest.slug, tunnel.url, port, dev.command);

    const stop = async (): Promise<void> => {
      app.stop();
      tunnel.stop();
      process.exit(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    const cycle = async (): Promise<{ store: { p_id: number; name: string; slug: string; storefront_url: string | null }; appPid: string }> => {
      const { manifest } = loadApp(flags.path, flags.config);
      const devManifest = withDevUrls(manifest, tunnel.url);
      const result = await api.deploy(devManifest).catch((error: Error) => this.error(error.message, { exit: 1 }));
      // Development builds release even with the explicit-submit switch on —
      // but if the backend ever gates one, dev cannot install what was never
      // created: say so instead of crashing on the union.
      if (result.status === 'review_required') {
        this.error(
          `v${result.version} needs review before it can install — run \`queek app submit ${devManifest.slug} --sequence ${result.sequence}\`, then \`queek app dev\` again.`,
          { exit: 1 },
        );
      }
      const store = await this.pickStore(api, flags.store);
      const installed = await api.devInstall(result.slug, store.p_id).catch((error: Error) => this.error(error.message, { exit: 1 }));
      this.log(`Dev: ${result.slug} ${result.version} on test store ${store.p_id} ← ${tunnel.url} (install ${installed.status})`);
      return { store, appPid: result.p_id };
    };

    let current = await cycle();
    const healthy = await waitForHealthy(`http://127.0.0.1:${port}/health`, 90_000);
    if (!healthy) {
      this.logToStderr(`The app did not answer http://127.0.0.1:${port}/health within 90s — its [app] log above says why. The tunnel and install are live; fix the app and it restarts.`);
    } else {
      this.links(current.store, current.appPid);
    }
    this.log(`Watching ${tomlPath} — save it to re-register ([dev] changes need a restart). Ctrl+C to stop.`);
    watch(tomlPath, { persistent: true }, async () => {
      try {
        current = await cycle();
        this.links(current.store, current.appPid);
      } catch (error) {
        this.logToStderr(`Re-register failed: ${(error as Error).message}`);
      }
    });
    await new Promise(() => {});
  }

  /**
   * Start the app with the dev env. Credentials come from `.queek/.env.local`
   * (or the environment for the secret), minted on first run (keys-generate
   * once / local random) and stored 0600 — the values are never printed. The
   * signing secret is NEVER rotated here (dev and production share one app
   * record): the run() gate already fetched a missing one back over the
   * developer session or stopped. The project's own `.env` fills the
   * rest, but CLI-owned keys always win.
   */
  private async startApp(
    api: DeveloperApi,
    dir: string,
    slug: string,
    tunnelUrl: string,
    port: number,
    command: string,
  ): Promise<{ stop: () => void }> {
    const appDir = resolve(dir);
    const queek = queekDir(dir);
    mkdirSync(queek, { recursive: true });
    const local = readEnvFile(envLocalPath(queek));
    const { kids } = await api.appKeys(slug).catch((error: Error) => this.error(error.message, { exit: 1 }));
    const secrets = await ensureDevSecrets(api, slug, local, kids, (line) => this.log(line), process.env.QUEEK_APP_SECRET).catch(
      (error: Error) => this.error(error.message, { exit: error instanceof MissingSecretError ? 2 : 1 }),
    );
    if (secrets.generated.length > 0) {
      const keep: Record<string, string> = {};
      for (const name of secrets.generated) keep[name] = secrets.values[name] as string;
      const file = writeEnvLocal(queek, keep);
      this.log(`Dev credentials written to ${file} (gitignored, 0600 — values are never printed).`);
    }
    const projectEnv = readEnvFile(join(appDir, '.env'));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...projectEnv,
      APP_BASE_URL: new URL(tunnelUrl).origin,
      PORT: String(port),
      NODE_ENV: 'development',
      QUEEK_API_BASE: apiBase(),
      ...secrets.values,
      PATH: `${join(appDir, 'node_modules', '.bin')}${delimiter}${process.env.PATH ?? ''}`,
    };
    this.log(`Starting the app: ${command} (port ${port})`);
    return startSupervised({
      command,
      cwd: appDir,
      env,
      log: (line) => this.log(line),
      logError: (line) => this.logToStderr(line),
    });
  }

  /**
   * The two links, once the app answers its health route. The storefront
   * comes from the API (test-stores rows carry it) — never constructed
   * here. The admin link is the Developer page's "Test on a store" section
   * (which has "Open in admin"), with the app addressed by p_id.
   */
  private links(store: { p_id: number; name: string; slug: string; storefront_url: string | null }, appPid: string): void {
    for (const line of devLinks(store, appPid)) this.log(line);
  }

  private async tunnel(dir: string, url: string | undefined, port: number): Promise<Tunnel> {
    if (url) return manualTunnel(url);
    this.logToStderr('Starting a tunnel…');
    const queek = queekDir(dir);
    mkdirSync(queek, { recursive: true });
    return startCloudflared(port, join(queek, 'cloudflared.log')).catch((error: Error) => this.error(error.message, { exit: 2 }));
  }

  private async pickStore(
    api: DeveloperApi,
    wanted: string | undefined,
  ): Promise<{ p_id: number; name: string; slug: string; storefront_url: string | null }> {
    const { data: stores, total } = await api.allTestStores().catch((error: Error) => this.error(error.message, { exit: 1 }));
    if (stores.length === 0) this.error('No owned test stores — create one on the dashboard first.', { exit: 2 });
    if (wanted) {
      const found = stores.find((store) => String(store.p_id) === wanted || store.name === wanted);
      if (!found) {
        this.error(`No owned test store '${wanted}'. Yours: ${stores.map((store) => `${store.p_id} (${store.name})`).join(', ')}.`, { exit: 2 });
      }
      return found;
    }
    if (total === 1 && stores[0]) return stores[0];
    this.error(`You own ${total} test stores — pass --store. Yours: ${stores.map((store) => `${store.p_id} (${store.name})`).join(', ')}.`, { exit: 2 });
  }
}

/** The two dev links, pure (tested in app-dev-urls.test.ts). */
export function devLinks(store: { name: string; storefront_url: string | null }, appPid: string): string[] {
  return [
    `Store admin: https://dashboard.usequeek.com/developers?section=test&app=${appPid}`,
    `Storefront: ${store.storefront_url ?? `the dashboard → test store '${store.name}'`}`,
  ];
}
