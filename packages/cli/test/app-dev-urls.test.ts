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
});
