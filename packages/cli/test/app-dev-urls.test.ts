import { describe, expect, it } from 'vitest';
import { devLinks, devStoreRefusal, handoffLine, previewUrl, withDevResources, withDevUrls } from '../src/commands/app/dev.js';
import type { DevStore } from '../src/lib/app-api.js';
import type { AppManifest } from '../src/lib/app-manifest.js';

const STORE: DevStore = { id: 7, p_id: 12, name: 'Hello dev', slug: 'hello-dev', storefront_url: null, admin_url: 'https://admin.example.com/store/hello-dev', created_at: null };

describe('dev ready block helpers (Shopify parity)', () => {
  it('logs handoff lines as HH:MM:SS │ source │ line, folding the [app] prefix into the source', () => {
    const at = new Date(2026, 8, 29, 9, 4, 7);
    expect(handoffLine('queek', 'Dev install: hello 1.0.0', at)).toBe('09:04:07 │ queek │ Dev install: hello 1.0.0');
    expect(handoffLine('app', '[app] listening on 3000', at)).toBe('09:04:07 │ app │ listening on 3000');
  });

  it('builds the Preview URL from the served admin_url, null without one', () => {
    expect(previewUrl('https://admin.example.com/store/hello-dev/', 'app_1')).toBe('https://admin.example.com/store/hello-dev/apps/app_1');
    expect(previewUrl(null, 'app_1')).toBeNull();
  });

  it('refuses a non-dev --store with the wrong-kind copy, never bare not-found', () => {
    const refusal = devStoreRefusal('live-shop', [STORE]);
    expect(refusal).toContain("Could not find dev store 'live-shop'");
    expect(refusal).toContain('Ensure the store is a dev store');
  });
});

describe('withDevResources (B2: the tunnel stops on every error path)', () => {
  it('stops everything when the task throws, then rethrows', async () => {
    const stopped: string[] = [];
    await expect(withDevResources(
      [() => { stopped.push('tunnel'); }, () => { stopped.push('app'); }],
      async () => { throw new Error('deploy refused'); },
    )).rejects.toThrow('deploy refused');
    expect(stopped).toEqual(['tunnel', 'app']);
  });

  it('stops everything on success too, and a throwing stopper never fails the run', async () => {
    const stopped: string[] = [];
    await withDevResources(
      [() => { stopped.push('tunnel'); }, () => { throw new Error('already dead'); }],
      async () => {},
    );
    expect(stopped).toEqual(['tunnel']);
  });
});

describe('devLinks (the two links after /health answers)', () => {
  it('prints the Developer test section for the app p_id and the served storefront URL', () => {
    expect(devLinks({ name: 'Test', storefront_url: 'https://test.usequeek.com' }, 'app_1')).toEqual([
      'Store admin: https://dashboard.usequeek.com/developers?section=test&app=app_1',
      'Storefront: https://test.usequeek.com',
    ]);
  });

  it('falls back to naming the store when the API serves no storefront URL', () => {
    expect(devLinks({ name: 'Test', storefront_url: null }, 'app_1')).toEqual([
      'Store admin: https://dashboard.usequeek.com/developers?section=test&app=app_1',
      "Storefront: the dashboard → test store 'Test'",
    ]);
  });
});

const MANIFEST: AppManifest = {
  slug: 'hello',
  name: 'Hello',
  scopes: ['merchant-business_profile-read'],
  install_url: 'https://hello.example.com/install',
  uninstall_url: 'https://hello.example.com/uninstall',
  settings_url: 'https://hello.example.com/settings',
  webhook_url: 'https://hello.example.com/hook',
};

describe('app dev URLs', () => {
  it('forces development distribution and re-points https origins at the tunnel', () => {
    const dev = withDevUrls({ ...MANIFEST, distribution: 'public' }, 'https://abc.trycloudflare.com');
    expect(dev.distribution).toBe('development');
    expect(dev.install_url).toBe('https://abc.trycloudflare.com/install');
    expect(dev.webhook_url).toBe('https://abc.trycloudflare.com/hook');
    // The caller's manifest is untouched.
    expect(MANIFEST.distribution).toBeUndefined();
  });

  it('leaves non-URL fields alone', () => {
    const dev = withDevUrls({ ...MANIFEST, version: '1.2.0' }, 'https://abc.trycloudflare.com');
    expect(dev.slug).toBe('hello');
    expect(dev.version).toBe('1.2.0');
  });

  it('rewrites nested same-origin leaves (notify/link/image) and spares off-origin URLs', () => {
    const dev = withDevUrls(
      {
        ...MANIFEST,
        logo_url: 'https://cdn.example.net/logo.png',
        dashboard: {
          blocks: [],
          actions: [
            {
              key: 'book',
              title: 'Book',
              target: 'order-details',
              scope: 'merchant-business_profile-read',
              effect: 'order_appointment',
              notify_url: 'https://hello.example.com/notify',
            },
          ],
          print: [],
        },
        extensions: {
          blocks: [
            {
              key: 'recs',
              type: 'app_block',
              title: 'Recs',
              targets: ['product'],
              link_url: 'https://hello.example.com/blocks/recs',
              image: { media_id: 'm1', url: 'https://hello.example.com/img/recs.png' },
            },
          ],
        },
      } as AppManifest,
      'https://abc.trycloudflare.com',
    );
    const action = (dev.dashboard as { actions: { notify_url: string }[] }).actions[0];
    expect(action.notify_url).toBe('https://abc.trycloudflare.com/notify');
    const block = (dev.extensions as { blocks: { link_url: string; image: { url: string } }[] }).blocks[0];
    expect(block.link_url).toBe('https://abc.trycloudflare.com/blocks/recs');
    expect(block.image.url).toBe('https://abc.trycloudflare.com/img/recs.png');
    expect(dev.logo_url).toBe('https://cdn.example.net/logo.png');
  });
});
