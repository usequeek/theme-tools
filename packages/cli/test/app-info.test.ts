import { describe, expect, it } from 'vitest';
import { infoLines, infoScopes } from '../src/commands/app/info.js';

describe('app info (Shopify info parity)', () => {
  it('prints the CURRENT APP CONFIGURATION box: file, app, ID, scopes, store, user', () => {
    expect(infoLines({
      file: '/work/hello/queek.app.toml',
      name: 'Hello',
      slug: 'hello',
      appId: 'app_1',
      scopes: ['merchant-business_profile-read'],
      store: 'Hello dev',
      user: 'developer session',
    })).toEqual([
      'Config file: /work/hello/queek.app.toml',
      'App: Hello (hello)',
      'App ID: app_1',
      'Scopes: merchant-business_profile-read',
      'Dev store: Hello dev',
      'User: developer session',
    ]);
  });

  it('names an unconfigured dev store with the --store pointer', () => {
    const [file, app, id, scopes, store, user] = infoLines({
      file: 'queek.app.toml',
      name: 'Hello',
      slug: 'hello',
      appId: 'app_1',
      scopes: [],
      store: null,
      user: 'automation token (CI)',
    });
    expect([file, app, id, scopes, store, user]).toContain('Dev store: Not yet configured (pass --store)');
    expect(user).toBe('User: automation token (CI)');
  });

  it('prefers server scopes, falls back to the local toml', () => {
    expect(infoScopes({ scopes: ['a-read'] }, ['b-read'])).toEqual(['a-read']);
    expect(infoScopes({}, ['b-read'])).toEqual(['b-read']);
    expect(infoScopes({ scopes: 'a-read' }, ['b-read'])).toEqual(['b-read']);
  });
});
