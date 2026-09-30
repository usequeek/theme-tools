import { randomUUID } from 'node:crypto';
import { mkdirSync, watch } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import * as p from '@clack/prompts';
import { Flags } from '@oclif/core';
import { apiFailureOf, DASHBOARD_URL, LoginNeededError, type DeveloperApi, type DevStore } from '../../lib/app-api.js';
import { apiBase } from '../../lib/app-auth.js';
import { appFlags, appSession } from '../../lib/app-command.js';
import { DEFAULT_DEV_PORT, loadApp, queekDir, resolveTomlPath, type AppManifest, type DevTable } from '../../lib/app-manifest.js';
import { ensureDevSecrets, envLocalPath, MissingSecretError, readEnvFile, resolveDevSecret, writeEnvLocal } from '../../lib/app-env.js';
import { startSupervised, waitForHealthy, type FetchFn } from '../../lib/app-run.js';
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

/**
 * One terminal handoff line, Shopify's shape (`HH:MM:SS │ <process> │ …`):
 * every install and every app stdout/stderr line carries its time + source.
 * app-run already prefixes `[app] ` — that folds into the source column
 * instead of printing twice.
 */
export function handoffLine(source: string, line: string, at: Date = new Date()): string {
  const clock = [at.getHours(), at.getMinutes(), at.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
  const text = source === 'app' ? line.replace(/^\[app\] /, '') : line;
  return `${clock} │ ${source} │ ${text}`;
}

/**
 * The Preview URL (D4): the served `admin_url` (`/open-store?store={p_id}`,
 * which switches into the dev store) plus `&app={slug}`, which routes to the
 * embedded app. Null when the backend sent no admin_url (the caller falls
 * back to the dashboard links) — never constructed from anything else.
 */
export function previewUrl(adminUrl: string | null, appSlug: string): string | null {
  if (!adminUrl) return null;
  return `${adminUrl}&app=${appSlug}`;
}

export function formatDevStores(stores: DevStore[]): string {
  return stores.map((store) => `${store.p_id} (${store.name})`).join(', ');
}

/**
 * Shopify's refusal shape (item 18: "Could not find store … Ensure … the
 * store is a dev store"): a --store that names no dev store never reads as
 * "not found", it reads as "wrong kind of store".
 */
export function devStoreRefusal(wanted: string, stores: DevStore[]): string {
  return `Could not find dev store '${wanted}'. Yours: ${formatDevStores(stores)}. Ensure the store is a dev store (dashboard → Developers → Dev stores) — merchant and test stores cannot run \`queek app dev\`.`;
}

/**
 * B2: everything started after the tunnel stops on EVERY exit path —
 * `this.error` throws through the task, so the finally owns the cleanup and
 * cloudflared is never left running. Stoppers never fail the run.
 */
export async function withDevResources(stops: Array<() => void>, task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } finally {
    for (const stop of stops) {
      try {
        stop();
      } catch {
        /* stopping never fails the run */
      }
    }
  }
}

/**
 * Dead-tunnel supervision (the Booking outage: the quick tunnel died and
 * `dev` kept serving the dead URL). The /health probe runs every 30s; two
 * misses in a row — or the cloudflared child exiting — restarts with
 * backoff, giving up after a sane number of failed starts with a clear
 * message. The restart reuses startCloudflared and the toml-save cycle; the
 * dead tunnel stops on every path, so no orphan cloudflared is left.
 */
export const TUNNEL_PROBE_INTERVAL_MS = 30_000;
export const TUNNEL_FAILURES_BEFORE_RESTART = 2;
export const MAX_TUNNEL_RESTARTS = 5;

/** Backoff between tunnel restarts: 5s, 10s, 20s, then 30s (attempt is 1-based). */
export function tunnelRestartBackoffMs(attempt: number): number {
  return Math.min(5_000 * 2 ** (attempt - 1), 30_000);
}

/** The one restart line: old → new tunnel with the new Preview URL. */
export function tunnelRestartLine(oldUrl: string, newUrl: string, preview: string | null): string {
  return `Tunnel restarted: ${oldUrl} → ${newUrl} — Preview URL: ${preview ?? newUrl}`;
}

/** Consecutive probe misses: restart on N in a row, reset on success. */
export function countTunnelMiss(ok: boolean, misses: number): { misses: number; restart: boolean } {
  if (ok) return { misses: 0, restart: false };
  const next = misses + 1;
  return next >= TUNNEL_FAILURES_BEFORE_RESTART ? { misses: 0, restart: true } : { misses: next, restart: false };
}

/** One /health probe of the tunnel URL: down, refused and non-2xx all read as false. */
export async function tunnelProbe(url: string, fetchFn?: FetchFn): Promise<boolean> {
  const get = fetchFn ?? (async (target: string) => fetch(target));
  try {
    return (await get(`${url}/health`)).ok;
  } catch {
    return false;
  }
}

/**
 * One tunnel restart: start the next tunnel, stop the dead one, re-register
 * (the toml-save cycle) with the new URL, print the one restart line.
 * Failed starts back off and give up after MAX_TUNNEL_RESTARTS with a clear
 * message; the dead tunnel stops on every path. A failed re-register keeps
 * the new tunnel and logs — the tunnel is up, the next save retries it.
 */
export async function restartDevTunnel(options: {
  oldTunnel: Tunnel;
  start: () => Promise<Tunnel>;
  reregister: (url: string) => Promise<{ preview: string | null }>;
  log: (line: string) => void;
  logError: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
  maxRestarts?: number;
  backoffMs?: (attempt: number) => number;
}): Promise<Tunnel> {
  const max = options.maxRestarts ?? MAX_TUNNEL_RESTARTS;
  const backoff = options.backoffMs ?? tunnelRestartBackoffMs;
  const sleep = options.sleep ?? ((ms: number) => new Promise((done) => setTimeout(done, ms)));
  let lastError: unknown;
  for (let attempt = 1; attempt <= max; attempt++) {
    if (attempt > 1) await sleep(backoff(attempt - 1));
    let next: Tunnel;
    try {
      next = await options.start();
    } catch (error) {
      lastError = error;
      continue;
    }
    try {
      options.oldTunnel.stop();
    } catch {
      /* already dead — the new tunnel is what matters */
    }
    let preview: string | null = null;
    try {
      preview = (await options.reregister(next.url)).preview;
    } catch (error) {
      options.logError(`Re-register after tunnel restart failed: ${(error as Error).message}`);
    }
    options.log(handoffLine('queek', tunnelRestartLine(options.oldTunnel.url, next.url, preview)));
    return next;
  }
  try {
    options.oldTunnel.stop();
  } catch {
    /* already dead */
  }
  const reason = lastError instanceof Error ? `: ${lastError.message}` : '';
  throw new Error(`Tunnel restart failed ${max} times${reason} — check your network or pass --url, then run \`queek app dev\` again.`);
}

export default class AppDev extends BaseCommand {
  // A long-running watcher has no result to print.
  static override enableJsonFlag = false;

  static override summary = 'Develop an app end to end: tunnel + dev install + your app running with injected env.';

  static override description = `Brings up a tunnel, registers the toml as a development build (same-semver unreleased rides the in-place rule — no version spam), installs it on an owned DEV store with scopes auto-granted (no consent screen), then starts the app from the toml's CLI-only \`[dev]\` table (\`command\`, e.g. "tsx watch src/index.ts") with the dev env injected (APP_BASE_URL=<tunnel origin>, PORT, NODE_ENV=development, QUEEK_API_BASE, plus the signing secret / keypair / encryption key from .queek/.env.local, minted on first run). With no dev store, the command asks once to create one named after the app with test data (--create-dev-store in CI). The ready block prints the tunnel URL and the Preview URL (the app open inside the dev store's dashboard); every install and app line logs with time + source. Saves to queek.app.toml re-register; \`[dev]\` changes need a restart. Automation tokens cannot run dev (dev-store reads are outside their grant) — sign in as a developer. Ctrl+C stops the app and the tunnel.`;

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --store 12',
    '<%= config.bin %> <%= command.id %> --create-dev-store',
    '<%= config.bin %> <%= command.id %> --url https://my-tunnel.trycloudflare.com',
  ];

  static override flags = {
    ...appFlags,
    store: Flags.string({ summary: 'The owned dev store (numeric p_id, slug or name). The only store when you own exactly one. Merchant and test stores are refused.', env: 'QUEEK_APP_STORE' }),
    'create-dev-store': Flags.boolean({ summary: 'With no dev store, create one named after the app with test data instead of asking (CI).', default: false }),
    'dev-store-name': Flags.string({ summary: 'Name for a first-run created dev store (default: "<app name> dev").', env: 'QUEEK_APP_DEV_STORE_NAME' }),
    'dev-store-address': Flags.string({ summary: 'Slug (address) for a first-run created dev store (default: backend derives it from the name). Taken slugs 422 with a suggestion.', env: 'QUEEK_APP_DEV_STORE_SLUG' }),
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
      this.error('`queek app dev` needs a developer session (dev-store reads are outside the automation grant) — run it where `queek auth login` works.', { exit: 2 });
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
    // let: a dead cloudflared tunnel restarts in place (superviseTunnel
    // below); the stopper always reads the current one, so no orphan.
    let tunnel = await this.tunnel(flags.path, flags.url, port);
    // B2: the tunnel (and the app, once started) stop on EVERY exit path —
    // error exits throw through the task into the finally.
    const stops: Array<() => void> = [() => tunnel.stop()];
    await withDevResources(stops, async () => {
      const app = await this.startApp(api, flags.path, first.manifest.slug, tunnel.url, port, dev.command);
      stops.unshift(() => app.stop());

      const stop = (): void => {
        app.stop();
        tunnel.stop();
        process.exit(0);
      };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);

      // The tunnel URL is a parameter (not the closure): the toml watcher
      // re-registers the current tunnel, the restart path the new one —
      // both run this same cycle.
      const cycle = async (tunnelUrl: string): Promise<{ store: DevStore; preview: string | null; appPid: string }> => {
        const { manifest } = loadApp(flags.path, flags.config);
        const devManifest = withDevUrls(manifest, tunnelUrl);
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
        const store = await this.pickDevStore(api, flags.store, {
          appName: first.manifest.name,
          create: flags['create-dev-store'],
          storeName: flags['dev-store-name'],
          storeSlug: flags['dev-store-address'],
          interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
        });
        // The backend delivers the install handoff to the app THROUGH the
        // tunnel, so a fresh quick-tunnel host that is not resolvable yet
        // answers 502 app_handoff_failed: retry a few times before giving up.
        const installOnce = () => api.devInstall(result.slug, store.p_id);
        let installed: Awaited<ReturnType<typeof installOnce>> | undefined;
        for (let attempt = 1; installed === undefined; attempt++) {
          try {
            installed = await installOnce();
          } catch (error) {
            const failure = apiFailureOf(error);
            // The backend requires a dev store (422 dev_store_required): a
            // store that stopped being one must read as wrong-kind, with the
            // server's reason verbatim.
            if (failure?.errorType === 'dev_store_required') {
              this.error(`Could not install on '${store.name}': ${failure.message} \`queek app dev\` needs a dev store (dashboard → Developers → Dev stores).`, { exit: 1 });
            }
            const retryable = failure?.status === 502 || failure?.errorType === 'app_handoff_failed';
            if (retryable && attempt < 4) {
              this.log(handoffLine('queek', `Install handoff could not reach ${tunnelUrl} yet — retrying (${attempt}/3)…`));
              await new Promise((done) => setTimeout(done, 5_000));
              continue;
            }
            const reason = failure ? `${failure.message}${failure.errorType ? ` (${failure.errorType})` : ''}` : (error as Error).message;
            this.error(`Dev install on '${store.name}' failed: ${reason}. Queek calls your app at ${tunnelUrl} — check the [app] log above and that ${tunnelUrl}/health answers.`, { exit: 1 });
          }
        }
        this.log(handoffLine('queek', `Dev install: ${result.slug} ${result.version} on dev store '${store.name}' ← ${tunnelUrl} (install ${installed.status})`));
        // The served preview wins; admin_url+slug rebuilds only as fallback.
        const preview = resolvePreview(installed.preview_url, store.admin_url, result.slug);
        return { store, preview, appPid: result.p_id };
      };

      // Install only once the app answers locally AND through the tunnel —
      // the backend's install handoff goes app ← tunnel, so installing first
      // races a cold app and a not-yet-resolvable tunnel host.
      const healthy = await waitForHealthy(`http://127.0.0.1:${port}/health`, 90_000);
      if (!healthy) {
        this.error(`The app did not answer http://127.0.0.1:${port}/health within 90s — its [app] log above says why. Fix it and run \`queek app dev\` again.`, { exit: 1 });
      }
      const reachable = await waitForHealthy(`${tunnel.url}/health`, 60_000);
      if (!reachable) {
        this.logToStderr(`The tunnel ${tunnel.url} did not answer /health within 60s — installing anyway; the install retries if Queek cannot reach it yet.`);
      }
      let current = await cycle(tunnel.url);
      this.readyBlock(tunnel.url, current.preview, current.store, current.appPid);
      this.log(`Watching ${tomlPath} — save it to re-register ([dev] changes need a restart). Ctrl+C to stop.`);
      watch(tomlPath, { persistent: true }, async () => {
        try {
          current = await cycle(tunnel.url);
          this.readyBlock(tunnel.url, current.preview, current.store, current.appPid);
        } catch (error) {
          this.logToStderr(`Re-register failed: ${(error as Error).message}`);
        }
      });
      // A give-up rejects the wait below, so the run throws through
      // withDevResources (stoppers kill the app and the latest tunnel).
      let failRun: (error: Error) => void = () => {};
      const running = new Promise<never>((_, reject) => {
        failRun = reject;
      });
      if (tunnel.how === 'cloudflared') {
        this.superviseTunnel({
          get: () => tunnel,
          set: (next) => {
            tunnel = next;
          },
          restart: () => startCloudflared(port, join(queekDir(flags.path), 'cloudflared.log')),
          reregister: async (url) => {
            current = await cycle(url);
            return { preview: current.preview };
          },
          fail: (error) => failRun(error),
        });
      }
      await running;
    });
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
      // The dashboard that frames the app's embedded pages (CSP frame-ancestors,
      // postMessage peer) — injected like Shopify injects its host values;
      // a value in the shell or the project .env still wins.
      QUEEK_DASHBOARD_ORIGINS: new URL(DASHBOARD_URL).origin,
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
      log: (line) => this.log(handoffLine('app', line)),
      logError: (line) => this.logToStderr(handoffLine('app', line)),
    });
  }

  /**
   * The Shopify-style ready block, once the app answers its health route:
   * tunnel URL plus the Preview URL (the app open inside the dev store's
   * dashboard, from the served admin_url). Without an admin_url, the
   * dashboard links stand in — the storefront comes from the API, never
   * constructed here.
   */
  private readyBlock(tunnelUrl: string, preview: string | null, store: DevStore, appPid: string): void {
    for (const line of readyLines(tunnelUrl, preview, store, appPid)) this.log(line);
  }

  private async tunnel(dir: string, url: string | undefined, port: number): Promise<Tunnel> {
    if (url) return manualTunnel(url);
    this.logToStderr('Starting a tunnel…');
    const queek = queekDir(dir);
    mkdirSync(queek, { recursive: true });
    return startCloudflared(port, join(queek, 'cloudflared.log')).catch((error: Error) => this.error(error.message, { exit: 2 }));
  }

  /**
   * Watch a cloudflared tunnel: probe /health every 30s and restart on
   * consecutive misses, at once on process exit. An exit that lands
   * mid-restart queues one more pass instead of being swallowed. Give-up
   * fails the run (the wait in run() rejects into the stoppers).
   */
  private superviseTunnel(state: {
    get: () => Tunnel;
    set: (next: Tunnel) => void;
    restart: () => Promise<Tunnel>;
    reregister: (url: string) => Promise<{ preview: string | null }>;
    fail: (error: Error) => void;
  }): void {
    let misses = 0;
    let restarting = false;
    let queued = false;
    const down = async (): Promise<void> => {
      if (restarting) {
        queued = true;
        return;
      }
      do {
        queued = false;
        restarting = true;
        try {
          const next = await restartDevTunnel({
            oldTunnel: state.get(),
            start: state.restart,
            reregister: state.reregister,
            log: (line) => this.log(line),
            logError: (line) => this.logToStderr(line),
          });
          state.set(next);
          next.onExit?.(() => void down());
          misses = 0;
        } catch (error) {
          state.fail(error as Error);
          return;
        } finally {
          restarting = false;
        }
      } while (queued);
    };
    state.get().onExit?.(() => void down());
    const timer = setInterval(() => {
      void (async () => {
        if (restarting) return;
        const stepped = countTunnelMiss(await tunnelProbe(state.get().url), misses);
        misses = stepped.misses;
        if (stepped.restart) await down();
      })().catch((error: Error) => state.fail(error));
    }, TUNNEL_PROBE_INTERVAL_MS);
    timer.unref?.();
  }

  /**
   * The dev-store selector. `--store` takes a p_id, slug or name and only
   * ever matches a dev store (anything else reads as wrong-kind, Shopify's
   * refusal shape). With no dev store at all: --create-dev-store (CI) or one
   * TTY question creates it with test data — named "<app name> dev" (R2)
   * unless --dev-store-name says otherwise, slug backend-derived unless
   * --dev-store-address names one; a non-interactive run without the flag
   * errors with the dashboard path. The 201's storefront password prints
   * once on stdout (never logs/debug) — the backend will not resend it.
   */
  private async pickDevStore(
    api: DeveloperApi,
    wanted: string | undefined,
    options: { appName: string; create: boolean; storeName?: string; storeSlug?: string; interactive: boolean },
  ): Promise<DevStore> {
    const { data: stores } = await api.devStores().catch((error: Error) => this.error(error.message, { exit: 1 }));
    if (stores.length === 0) {
      const name = options.storeName ?? defaultDevStoreName(options.appName);
      const ask = options.create || (options.interactive && this.answer<boolean>(await p.confirm({
        message: `No dev stores yet — create one named '${name}' with test data?`,
      })));
      if (ask) {
        const created = await api.createDevStore(name, true, randomUUID(), options.storeSlug).catch((error: Error) => this.error(error.message, { exit: 1 }));
        this.log(`Created dev store '${created.name}' with test data.`);
        if (typeof created.storefront_password === 'string' && created.storefront_password !== '') {
          this.log(`Storefront password: ${created.storefront_password}`);
        }
        return created;
      }
      this.error('No dev stores — create one on the dashboard (Developers → Dev stores), or pass --create-dev-store to make one named after this app with test data.', { exit: 2 });
    }
    if (wanted) {
      const found = stores.find((store) => String(store.p_id) === wanted || store.name === wanted || store.slug === wanted);
      if (!found) this.error(devStoreRefusal(wanted, stores), { exit: 2 });
      return found;
    }
    const only = stores.length === 1 ? stores[0] : undefined;
    if (only) return only;
    this.error(`You own ${stores.length} dev stores — pass --store. Yours: ${formatDevStores(stores)}.`, { exit: 2 });
  }

  private answer<T>(value: T | symbol): T {
    if (p.isCancel(value)) this.error('Cancelled.', { exit: 130 });
    return value as T;
  }
}

/** The two dev links, pure (tested in app-dev-urls.test.ts). */
export function devLinks(store: { name: string; storefront_url: string | null }, appPid: string): string[] {
  return [
    `Store admin: ${DASHBOARD_URL}/developers?section=test&app=${appPid}`,
    `Storefront: ${store.storefront_url ?? `the dashboard → test store '${store.name}'`}`,
  ];
}

/**
 * Served preview wins; admin_url+slug rebuilds only as fallback (the
 * backend computes the same value server-side — never diverge from it).
 */
export function resolvePreview(served: string | undefined, adminUrl: string | null, appSlug: string): string | null {
  return served ?? previewUrl(adminUrl, appSlug);
}

/**
 * First-run default dev-store name (R2): "<app name> dev" — the backend
 * derives the slug (slugified name + "-dev") unless --dev-store-address
 * names one explicitly.
 */
export function defaultDevStoreName(appName: string): string {
  return `${appName} dev`;
}

/**
 * The Shopify-style ready block lines, pure for tests. The storefront
 * password (R1) is a shareable dev password, shown like Shopify shows it —
 * stdout only, one line, omitted when the backend did not serve one. It
 * never reaches debug output or logs: readyLines callers print, never store.
 */
export function readyLines(tunnelUrl: string, preview: string | null, store: DevStore, appPid: string): string[] {
  const lines = ['✅ Ready, watching for changes', `Tunnel: ${tunnelUrl}`];
  if (preview) lines.push(`Preview URL: ${preview}`);
  else lines.push(...devLinks(store, appPid));
  if (typeof store.storefront_password === 'string' && store.storefront_password !== '') {
    lines.push(`Storefront password: ${store.storefront_password}`);
  }
  return lines;
}
