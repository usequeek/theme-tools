import { mkdirSync, watch } from 'node:fs';
import { join } from 'node:path';
import { Flags } from '@oclif/core';
import { LoginNeededError, type DeveloperApi } from '../../lib/app-api.js';
import { appFlags, appSession } from '../../lib/app-command.js';
import { loadApp, queekDir, resolveTomlPath, type AppManifest } from '../../lib/app-manifest.js';
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

  static override summary = 'Develop against an owned test store: tunnel + dev install + watch.';

  static override description = `Brings up a tunnel, registers the toml as a development build (same-semver unreleased rides the in-place rule — no version spam), installs it on an owned test store, and re-registers whenever queek.app.toml changes. Run your app server (npm start) in another terminal; this command owns the tunnel, the registration and the install. Automation tokens cannot run dev (test-store reads are outside their grant) — sign in as a developer. Ctrl+C stops the tunnel.`;

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --store 12',
    '<%= config.bin %> <%= command.id %> --url https://my-tunnel.trycloudflare.com',
  ];

  static override flags = {
    ...appFlags,
    store: Flags.string({ summary: 'The owned test store (numeric p_id or name). The only store when you own exactly one.', env: 'QUEEK_APP_STORE' }),
    port: Flags.integer({ summary: 'Your local app server port the tunnel forwards to.', default: 3000, min: 1, max: 65535 }),
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

    const tomlPath = resolveTomlPath(flags.path, flags.config);
    const tunnel = await this.tunnel(flags.path, flags.url, flags.port);
    const stop = async (): Promise<void> => {
      tunnel.stop();
      process.exit(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    let warned = false;
    const register = async (): Promise<void> => {
      const { manifest, warnings } = loadApp(flags.path, flags.config);
      if (!warned) {
        warned = true;
        for (const warning of warnings) this.logToStderr(`Warning: ${warning}`);
      }
      const devManifest = withDevUrls(manifest, tunnel.url);
      const result = await api.deploy(devManifest).catch((error: Error) => this.error(error.message, { exit: 1 }));
      const storePid = await this.pickStore(api, flags.store);
      const installed = await api.devInstall(result.slug, storePid).catch((error: Error) => this.error(error.message, { exit: 1 }));
      this.log(`Dev: ${result.slug} ${result.version} on test store ${storePid} ← ${tunnel.url} (install ${installed.status})`);
    };

    await register();
    this.log(`Watching ${tomlPath} — save it to re-register. Ctrl+C to stop.`);
    watch(tomlPath, { persistent: true }, async () => {
      try {
        await register();
      } catch (error) {
        this.logToStderr(`Re-register failed: ${(error as Error).message}`);
      }
    });
    await new Promise(() => {});
  }

  private async tunnel(dir: string, url: string | undefined, port: number): Promise<Tunnel> {
    if (url) return manualTunnel(url);
    this.logToStderr('Starting a tunnel…');
    const queek = queekDir(dir);
    mkdirSync(queek, { recursive: true });
    return startCloudflared(port, join(queek, 'cloudflared.log')).catch((error: Error) => this.error(error.message, { exit: 2 }));
  }

  private async pickStore(api: DeveloperApi, wanted: string | undefined): Promise<number> {
    const { data: stores, total } = await api.allTestStores().catch((error: Error) => this.error(error.message, { exit: 1 }));
    if (stores.length === 0) this.error('No owned test stores — create one on the dashboard first.', { exit: 2 });
    if (wanted) {
      const found = stores.find((store) => String(store.p_id) === wanted || store.name === wanted);
      if (!found) {
        this.error(`No owned test store '${wanted}'. Yours: ${stores.map((store) => `${store.p_id} (${store.name})`).join(', ')}.`, { exit: 2 });
      }
      return found.p_id;
    }
    if (total === 1) return stores[0].p_id;
    this.error(`You own ${total} test stores — pass --store. Yours: ${stores.map((store) => `${store.p_id} (${store.name})`).join(', ')}.`, { exit: 2 });
  }
}
