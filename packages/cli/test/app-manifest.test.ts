import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_TOML,
  fromManifest,
  loadApp,
  loadTomlFile,
  resolveTomlPath,
  toManifest,
  TomlError,
} from '../src/lib/app-manifest.js';

const BASE = `
slug = "hello"
name = "Hello World"

[access]
scopes = ["merchant-business_profile-read"]

[app]
install_url = "https://hello.example.com/install"
uninstall_url = "https://hello.example.com/uninstall"
`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Insert top-level lines before the first [table] — TOML joins trailing keys to the last table. */
function top(extra: string): string {
  return BASE.replace('[access]', `${extra}[access]`);
}

function stage(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'app-toml-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

describe('queek.app.toml', () => {
  it('maps a minimal toml onto the manifest (never a version; distribution defaults)', () => {
    const dir = stage({ [APP_TOML]: BASE });
    const { manifest, warnings } = loadApp(dir);
    expect(manifest.slug).toBe('hello');
    expect(manifest.scopes).toEqual(['merchant-business_profile-read']);
    expect(manifest.version).toBeUndefined();
    expect(manifest.distribution).toBeUndefined();
    expect(manifest.install_url).toBe('https://hello.example.com/install');
    expect(warnings).toEqual([]);
  });

  it('ignores a leftover toml version with a once-warning (use --version)', () => {
    const { doc } = loadTomlFile(stageFile(top('version = "1.0.0"\n')));
    const { manifest, warnings } = toManifest(doc);
    expect(manifest.version).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('--version');
  });

  it('resolves -c/--config variants (queek.app.<name>.toml)', () => {
    const dir = stage({ [APP_TOML]: BASE, 'queek.app.staging.toml': top('distribution = "development"\n') });
    expect(resolveTomlPath(dir, 'staging')).toBe(join(dir, 'queek.app.staging.toml'));
    expect(loadApp(dir, 'staging').manifest.distribution).toBe('development');
    expect(() => resolveTomlPath(dir, 'missing')).toThrow(TomlError);
  });

  it('accepts handle instead of slug, and refuses slug + handle together', () => {
    const { doc } = loadTomlFile(stageFile(`${BASE.replace('slug = "hello"', 'handle = "hello"')}`));
    expect(toManifest(doc).manifest.slug).toBe('hello');
    const both = loadTomlFile(stageFile(top('handle = "other"\n')));
    expect(() => toManifest(both.doc)).toThrow('either');
  });

  it('rejects unknown top-level keys with the backend error text', () => {
    const { doc } = loadTomlFile(stageFile(`${BASE}\nbogus = "x"\n`));
    expect(() => toManifest(doc)).toThrow("Unknown field 'bogus' in manifest.");
  });

  it('rejects a bad slug and distribution', () => {
    const bad = (toml: string): string => {
      try {
        toManifest(loadTomlFile(stageFile(toml)).doc);
        return 'no error';
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(bad(`${BASE.replace('slug = "hello"', 'slug = "Hello!"')}`)).toContain('slug must be');
    expect(bad(top('distribution = "private"\n'))).toContain('one of: public, development');
    expect(bad(`${BASE.replace('[access]', '[access]\n').replace('scopes = ["merchant-business_profile-read"]', 'scopes = ["merchant-apps-install"]')}`)).toContain(
      'can never be granted',
    );
  });

  it('requires webhook_url when topics are present', () => {
    const { doc } = loadTomlFile(stageFile(`${BASE}\n[webhooks]\ntopics = ["orders/updated"]\n`));
    expect(() => toManifest(doc)).toThrow('webhook_url');
  });

  it('refuses secrets in the toml', () => {
    const secreted = loadTomlFile(stageFile(top('QUEEK_APP_SECRET = "whsec_abc"\n')));
    // Top-level unknown secrets trip the unknown-key rule first…
    expect(() => toManifest(secreted.doc)).toThrow(/Unknown field|secret/i);
    const nested = loadTomlFile(stageFile(`${BASE}\n[webhooks]\nurl = "https://example.com/hook"\nsecret = "whsec_abc"\n`));
    expect(() => toManifest(nested.doc)).toThrow(/secret/i);
  });

  it('round-trips server → toml → manifest', () => {
    const server = {
      slug: 'hello', name: 'Hello', version: '1.2.0', scopes: ['merchant-business_profile-read'],
      install_url: 'https://hello.example.com/install', uninstall_url: 'https://hello.example.com/uninstall',
      webhook_topics: ['orders/updated'], webhook_url: 'https://hello.example.com/hook',
      settings: [{ key: 'greeting', label: 'Greeting', type: 'string' }],
    };
    const toml = fromManifest(server);
    expect(toml).toContain('queek.app.toml');
    expect(toml).not.toContain('1.2.0');
    const back = toManifest(loadTomlFile(stageFile(toml)).doc);
    expect(back.manifest.slug).toBe('hello');
    expect(back.manifest.version).toBeUndefined();
    expect(back.warnings).toEqual([]);
    expect(back.manifest.webhook_topics).toEqual(['orders/updated']);
    expect(back.manifest.settings).toEqual([{ key: 'greeting', label: 'Greeting', type: 'string' }]);
  });

  it('checks dashboard enums and the action-scope grant rule', () => {
    const action = (scope: string): string => `
${BASE}
[dashboard]
[[dashboard.actions]]
key = "book"
title = "Book"
target = "order-details"
scope = "${scope}"
effect = "order_appointment"
notify_url = "https://hello.example.com/notify"
`;
    expect(() => toManifest(loadTomlFile(stageFile(action('merchant-orders-write'))).doc)).toThrow('never grants');
    const ok = toManifest(loadTomlFile(stageFile(action('merchant-business_profile-read'))).doc);
    expect((ok.manifest.dashboard as { actions: unknown[] }).actions).toHaveLength(1);
    expect(() => toManifest(loadTomlFile(stageFile(action('merchant-business_profile-read').replace('order_appointment', 'teleport'))).doc)).toThrow(
      'order_appointment',
    );
  });
});

function stageFile(content: string): string {
  const dir = stage({ [APP_TOML]: content });
  return join(dir, APP_TOML);
}

const BLOCK = `
[extensions]
[[extensions.blocks]]
key = "recs"
title = "Recommendations"
targets = ["product"]
`;

describe('backend parity (validator origin/master 29/9)', () => {
  it("accepts available_if: declared_products on a block (BLOCK_AVAILABLE_IF)", () => {
    const { doc } = loadTomlFile(stageFile(`${BASE}${BLOCK}available_if = "declared_products"\n`));
    const { manifest, warnings } = toManifest(doc);
    expect(warnings).toEqual([]);
    expect((manifest.extensions as { blocks: { available_if: string }[] }).blocks[0].available_if).toBe('declared_products');
  });

  it('refuses other visibility conditions with the backend wording', () => {
    const { doc } = loadTomlFile(stageFile(`${BASE}${BLOCK}available_if = "always"\n`));
    expect(() => toManifest(doc)).toThrow('The block visibility condition must be one of: declared_products.');
  });

  it('rejects unknown keys at every nested level, backend lists', () => {
    const bad = (toml: string): string => {
      try {
        toManifest(loadTomlFile(stageFile(toml)).doc);
        return 'no error';
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(bad(`${BASE}\n[extensions]\nstray = 1\n`)).toContain("Unknown field 'stray' in manifest.extensions.");
    expect(bad(`${BASE}\n[extensions.proxy]\nurl = "https://x.example.com/p"\nsubpath = "hello"\nstray = 1\n`)).toContain(
      "Unknown field 'stray' in manifest.extensions.proxy.",
    );
    expect(bad(`${BASE}${BLOCK}[extensions.blocks.image]\nstray = 1\n`)).toContain("Unknown field 'stray' in manifest.extensions.blocks[0].image.");
    expect(bad(`${BASE}\n[dashboard]\nstray = 1\n`)).toContain("Unknown field 'stray' in manifest.dashboard.");
    expect(bad(`${BASE}\n[dashboard]\n[[dashboard.print]]\nkey = "p"\ntitle = "P"\ntarget = "order-print"\n[[dashboard.print.fields]]\nkey = "f"\nlabel = "F"\nstray = 1\n`)).toContain("Unknown field 'stray' in manifest.dashboard.print[0].fields[0].");
  });

  it('requires https on link/image/notify URLs like the other app URLs', () => {
    const bad = (toml: string): string => {
      try {
        toManifest(loadTomlFile(stageFile(toml)).doc);
        return 'no error';
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(bad(`${BASE}${BLOCK}link_url = "http://x.example.com/l"\n`)).toContain('must be an https URL');
    expect(bad(`${BASE}\n[dashboard]\n[[dashboard.actions]]\nkey = "b"\ntitle = "B"\ntarget = "order-details"\nscope = "merchant-business_profile-read"\neffect = "order_appointment"\nnotify_url = "http://x.example.com/n"\n`)).toContain('must be an https URL');
  });

  it('uses the backend sentence for topics-without-receiver', () => {
    const { doc } = loadTomlFile(stageFile(`${BASE}\n[webhooks]\ntopics = ["orders/updated"]\n`));
    expect(() => toManifest(doc)).toThrow('webhook_topics needs webhook_url: topics without a receiver URL are refused.');
  });
});
