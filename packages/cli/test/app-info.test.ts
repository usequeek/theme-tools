import { describe, expect, it } from 'vitest';
import { infoLines, infoScopes } from '../src/commands/app/info.js';

describe('app info', () => {
  it('prints the CURRENT APP CONFIGURATION box: file, app, ID, scopes, store, password, user', () => {
    expect(infoLines({
      file: '/work/hello/queek.app.toml',
      name: 'Hello',
      slug: 'hello',
      appId: 'app_1',
      scopes: ['merchant-business_profile-read'],
      store: 'Hello dev',
      storefrontPassword: 'dev-pass-123',
      user: 'developer session',
    })).toEqual([
      'Config file: /work/hello/queek.app.toml',
      'App: Hello (hello)',
      'App ID: app_1',
      'Scopes: merchant-business_profile-read',
      'Dev store: Hello dev',
      'Storefront password: dev-pass-123',
      'User: developer session',
    ]);
  });

  it('names an unconfigured dev store with the --store pointer', () => {
    const [file, app, id, scopes, store, password, user] = infoLines({
      file: 'queek.app.toml',
      name: 'Hello',
      slug: 'hello',
      appId: 'app_1',
      scopes: [],
      store: null,
      storefrontPassword: null,
      user: 'automation token (CI)',
    });
    expect([file, app, id, scopes, store, password, user]).toContain('Dev store: Not yet configured (pass --store)');
    expect(password).toBe('Storefront password: pass --store to show it');
    expect(user).toBe('User: automation token (CI)');
  });

  it('says so when the backend served no password for the store', () => {
    const lines = infoLines({
      file: 'queek.app.toml',
      name: 'Hello',
      slug: 'hello',
      appId: 'app_1',
      scopes: [],
      store: 'Hello dev',
      storefrontPassword: null,
      user: 'developer session',
    });
    expect(lines).toContain('Storefront password: not served for this store');
  });

  it('prefers server scopes, falls back to the local toml', () => {
    expect(infoScopes({ scopes: ['a-read'] }, ['b-read'])).toEqual(['a-read']);
    expect(infoScopes({}, ['b-read'])).toEqual(['b-read']);
    expect(infoScopes({ scopes: 'a-read' }, ['b-read'])).toEqual(['b-read']);
  });
});
