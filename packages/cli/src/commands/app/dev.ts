import { mkdirSync, watch } from 'node:fs';
import { join } from 'node:path';
import { Flags } from '@oclif/core';
import { appApi, appFlags, requireToken } from '../../lib/app-command.js';
import { loadApp, queekDir, resolveTomlPath, type AppManifest } from '../../lib/app-manifest.js';
import { manualTunnel, startCloudflared, type Tunnel } from '../../lib/app-tunnel.js';
import { BaseCommand } from '../../lib/base-command.js';

const URL_KEYS = ['install_url', 'uninstall_url', 'settings_url', 'webhook_url', 'logo_url', 'developer_url', 'privacy_url', 'support_url'] as const;

/** Point every https URL in the manifest at the tunnel origin (paths kept). */
export function withDevUrls(manifest: AppManifest, tunnelUrl: string): AppManifest {
  const tunnel = new URL(tunnelUrl);
  const swap = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:') return value;
      url.protocol = tunnel.protocol;
      url.host = tunnel.host;
      return url.toString();
    } catch {
      return value;
    }
  };
  const out: AppManifest = { ...manifest, distribution: 'development' };
  for (const key of URL_KEYS) {
    if (out[key] !== undefined) (out as Record<string, unknown>)[key] = swap(out[key]);
  }
  if (out.extensions !== undefined) {
    const extensions = JSON.parse(JSON.stringify(out.extensions)) as Record<string, unknown>;
    const proxy = extensions.proxy as Record<string, unknown> | undefined;
    if (proxy?.url) proxy.url = swap(proxy.url);
    if (typeof extensions.merchant_page_url === 'string') extensions.merchant_page_url = swap(extensions.merchant_page_url);
    out.extensions = extensions as AppManifest['extensions'];
  }
  return out;
}

export default class AppDev extends BaseCommand {
  // A long-running watcher has no result to print.
  static override enableJsonFlag = false;

  static override summary = 'Develop against an owned test store: tunnel + dev install + watch.';

  static override description = `Brings up a tunnel, registers the toml as a development build (same-semver unreleased rides the in-place rule — no version spam), installs it on an owned test store, and re-registers whenever queek.app.toml changes. Run your app server (pnpm dev) in another terminal; this command owns the tunnel, the registration and the install. Ctrl+C stops the tunnel.`;

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --store test-store-1',
    '<%= config.bin %> <%= command.id %> --url https://my-tunnel.trycloudflare.com',
  ];

  static override flags = {
    ...appFlags,
    store: Flags.string({ summary: 'The owned test store (p_id or name). The only store when you own exactly one.', env: 'QUEEK_APP_STORE' }),
    port: Flags.integer({ summary: 'Your local app server port the tunnel forwards to.', default: 3000, min: 1, max: 65535 }),
    url: Flags.string({ summary: 'Your own tunnel URL (https). Skips starting cloudflared.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AppDev);
    this.setVerbose(flags.verbose as boolean | undefined);
    const { token } = await requireToken().catch((error: Error) => this.error(error.message, { exit: 2 }));
    const api = appApi();

    const tomlPath = resolveTomlPath(flags.path, flags.config);
    const tunnel = await this.tunnel(flags.path, flags.url, flags.port);
    const stop = async (): Promise<void> => {
      tunnel.stop();
      process.exit(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);

    const register = async (): Promise<{ slug: string; version: string }> => {
      const { manifest } = loadApp(flags.path, flags.config);
      const devManifest = withDevUrls(manifest, tunnel.url);
      const result = await api.deploy(token, devManifest).catch((error: Error) => this.error(error.message, { exit: 1 }));
      const storePid = await this.pickStore(api, token, flags.store);
      await api.devInstall(token, result.slug, storePid).catch((error: Error) => this.error(error.message, { exit: 1 }));
      this.log(`Dev: ${result.slug} ${result.version} on test store ${storePid} ← ${tunnel.url}`);
      return { slug: result.slug, version: result.version };
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

  private async pickStore(api: ReturnType<typeof appApi>, token: string, wanted: string | undefined): Promise<string> {
    const { data: stores } = await api.testStores(token).catch((error: Error) => this.error(error.message, { exit: 1 }));
    if (stores.length === 0) this.error('No owned test stores — create one on the dashboard first.', { exit: 2 });
    if (wanted) {
      const found = stores.find((store) => store.p_id === wanted || store.name === wanted);
      if (!found) {
        this.error(`No owned test store '${wanted}'. Yours: ${stores.map((store) => store.p_id).join(', ')}.`, { exit: 2 });
      }
      return found.p_id;
    }
    if (stores.length === 1) return stores[0].p_id;
    this.error(`You own ${stores.length} test stores — pass --store. Yours: ${stores.map((store) => store.p_id).join(', ')}.`, { exit: 2 });
  }
}
