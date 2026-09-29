import { describe, expect, it } from 'vitest';
import { withDevUrls } from '../src/commands/app/dev.js';
import type { AppManifest } from '../src/lib/app-manifest.js';

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
