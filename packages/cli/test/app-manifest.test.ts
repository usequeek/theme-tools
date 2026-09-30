import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APP_TOML,
  fromManifest,
  loadApp,
  loadTomlFile,
  preserveDevTable,
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

  it('parses the CLI-only [dev] table and strips it from the manifest (never sent, like handle)', () => {
    const { doc } = loadTomlFile(stageFile(`${BASE}\n[dev]\ncommand = "tsx watch src/index.ts"\nport = 3001\n`));
    const { manifest, dev } = toManifest(doc);
    expect(dev).toEqual({ command: 'tsx watch src/index.ts', port: 3001 });
    expect(manifest).not.toHaveProperty('dev');
    expect(Object.keys(manifest)).not.toContain('dev');
    const dir = stage({ [APP_TOML]: `${BASE}\n[dev]\ncommand = "tsx watch src/index.ts"\n` });
    expect(loadApp(dir).dev).toEqual({ command: 'tsx watch src/index.ts', port: 3000 });
  });

  it('defaults [dev].port and rejects a missing command, a bad port and stray keys (exit 2)', () => {
    const bare = loadTomlFile(stageFile(`${BASE}\n[dev]\ncommand = "npm run dev"\n`));
    expect(toManifest(bare.doc).dev).toEqual({ command: 'npm run dev', port: 3000 });
    expect(() => toManifest(loadTomlFile(stageFile(`${BASE}\n[dev]\nport = 3000\n`)).doc)).toThrow(
      'The dev.command field is required (how `queek app dev` starts the app, e.g. "tsx watch src/index.ts").',
    );
    expect(() => toManifest(loadTomlFile(stageFile(`${BASE}\n[dev]\ncommand = "x"\nport = 99999\n`)).doc)).toThrow(
      'The dev.port must be a port number (1-65535).',
    );
    expect(() => toManifest(loadTomlFile(stageFile(`${BASE}\n[dev]\ncommand = "x"\nwatch = true\n`)).doc)).toThrow(
      "Unknown field 'watch' in manifest.dev.",
    );
    try {
      toManifest(loadTomlFile(stageFile(`${BASE}\n[dev]\nport = 3000\n`)).doc);
      expect.unreachable('expected a TomlError');
    } catch (error) {
      expect(error).toBeInstanceOf(TomlError);
      expect((error as Error & { exitCode: number }).exitCode).toBe(2);
    }
  });

  it('keeps the recorded [dev] table across config link --force (the server manifest has none)', () => {
    const existing = `${BASE}\n[dev]\ncommand = "tsx watch src/index.ts"\nport = 3001\n`;
    const linked = '# queek.app.toml — local source of truth\nslug = "hello"\nname = "Hello World"\n\n[access]\nscopes = ["merchant-business_profile-read"]\n\n[app]\ninstall_url = "https://hello.example.com/install"\nuninstall_url = "https://hello.example.com/uninstall"\n';
    const kept = preserveDevTable(existing, linked);
    expect(kept).toContain('[dev]');
    expect(kept).toContain('command = "tsx watch src/index.ts"');
    // And the kept file still validates with the same table.
    expect(toManifest(loadTomlFile(stageFile(kept)).doc).dev).toEqual({ command: 'tsx watch src/index.ts', port: 3001 });
    expect(preserveDevTable(`${BASE}\n`, linked)).toBe(linked);
    expect(preserveDevTable('not toml [[[', linked)).toBe(linked);
  });

  it('uses the backend sentence for topics-without-receiver', () => {
    const { doc } = loadTomlFile(stageFile(`${BASE}\n[webhooks]\ntopics = ["orders/updated"]\n`));
    expect(() => toManifest(doc)).toThrow('webhook_topics needs webhook_url: topics without a receiver URL are refused.');
  });

  it('requires key + title on every extension block (backend key/title rules, exit 2)', () => {
    const noTitle = BLOCK.replace('title = "Recommendations"\n', '');
    const noKey = BLOCK.replace('key = "recs"\n', '');
    expect(() => toManifest(loadTomlFile(stageFile(`${BASE}${noTitle}`)).doc)).toThrow(
      'The manifest.extensions.blocks[0].title field is required (max 80).',
    );
    expect(() => toManifest(loadTomlFile(stageFile(`${BASE}${noKey}`)).doc)).toThrow(
      'The manifest.extensions.blocks[0].key must match [a-z0-9_]{1,64}.',
    );
    const longTitle = BLOCK.replace('title = "Recommendations"', `title = "${'T'.repeat(81)}"`);
    expect(() => toManifest(loadTomlFile(stageFile(`${BASE}${longTitle}`)).doc)).toThrow(
      'The manifest.extensions.blocks[0].title field is required (max 80).',
    );
  });

  it('requires key + title on every dashboard block, action and print row (exit 2)', () => {
    const block = (body: string): string => `${BASE}\n[dashboard]\n[[dashboard.blocks]]\n${body}target = "order-details"\n`;
    const action = (body: string): string =>
      `${BASE}\n[dashboard]\n[[dashboard.actions]]\n${body}target = "order-details"\nscope = "merchant-business_profile-read"\neffect = "order_appointment"\nnotify_url = "https://hello.example.com/notify"\n`;
    const print = (body: string): string => `${BASE}\n[dashboard]\n[[dashboard.print]]\n${body}target = "order-print"\n`;
    expect(() => toManifest(loadTomlFile(stageFile(block('key = "b"\n'))).doc)).toThrow(
      'The manifest.dashboard.blocks[0].title field is required (max 80).',
    );
    expect(() => toManifest(loadTomlFile(stageFile(block('title = "B"\n'))).doc)).toThrow(
      'The manifest.dashboard.blocks[0].key must match [a-z0-9_]{1,64}.',
    );
    expect(() => toManifest(loadTomlFile(stageFile(action('key = "a"\n'))).doc)).toThrow(
      'The manifest.dashboard.actions[0].title field is required (max 80).',
    );
    expect(() => toManifest(loadTomlFile(stageFile(action('title = "A"\n'))).doc)).toThrow(
      'The manifest.dashboard.actions[0].key must match [a-z0-9_]{1,64}.',
    );
    expect(() => toManifest(loadTomlFile(stageFile(print('key = "p"\n'))).doc)).toThrow(
      'The manifest.dashboard.print[0].title field is required (max 80).',
    );
    expect(() => toManifest(loadTomlFile(stageFile(print('title = "P"\n'))).doc)).toThrow(
      'The manifest.dashboard.print[0].key must match [a-z0-9_]{1,64}.',
    );
  });

  it('mirrors the backend length caps locally (exit 2, never a 422)', () => {
    const bad = (toml: string): string => {
      try {
        toManifest(loadTomlFile(stageFile(toml)).doc);
        return 'no error';
      } catch (error) {
        expect(error).toBeInstanceOf(TomlError);
        return (error as Error).message;
      }
    };
    const long = (n: number): string => 'x'.repeat(n);
    expect(bad(`${BASE}\n[[settings]]\nkey = "s"\nlabel = "S"\ntype = "string"\nhelp = "${long(501)}"\n`)).toContain(
      'The settings[0].help field must be a string (max 500).',
    );
    expect(bad(`${BASE}${BLOCK}description = "${long(501)}"\n`)).toContain(
      'The manifest.extensions.blocks[0].description field must be a string (max 500).',
    );
    expect(bad(`${BASE}\n[extensions.proxy]\nurl = "https://x.example.com/${long(2028)}"\nsubpath = "hello"\n`)).toContain(
      'The extensions.proxy.url must not be longer than 2048 characters.',
    );
    expect(bad(`${BASE}\n[dashboard]\n[[dashboard.print]]\nkey = "p"\ntitle = "P"\ntarget = "order-print"\n${'[[dashboard.print.fields]]\nkey = "f"\nlabel = "F"\n'.repeat(21)}`)).toContain(
      'The manifest.dashboard.print[0].fields must not have more than 20 fields.',
    );
    const manyOptions = Array.from({ length: 51 }, (_, i) => `"o${i}"`).join(', ');
    expect(
      bad(`${BASE}${BLOCK}[[extensions.blocks.schema]]\nkey = "c"\nlabel = "C"\ntype = "select"\noptions = [${manyOptions}]\n`),
    ).toContain('The manifest.extensions.blocks[0].schema[0].options must not have more than 50 options.');
    expect(
      bad(`${BASE}\n[[settings]]\nkey = "s"\nlabel = "S"\ntype = "select"\noptions = ["${long(121)}"]\n`),
    ).toContain('The settings[0].options[0] must be a string (max 120).');
  });
});

describe('[[extensions.nav]] — the app menu in the dashboard sidebar', () => {
  const withNav = (nav: string) =>
    `${BASE}
[extensions]
merchant_page_url = "https://hello.example.com/admin"

${nav}`;

  it('maps label + path onto manifest.extensions.nav', () => {
    const dir = stage({
      [APP_TOML]: withNav(`[[extensions.nav]]
label = "Bookings"
path = "/admin"

[[extensions.nav]]
label = "Services"
path = "/admin/services"
`),
    });
    const { manifest } = loadApp(dir);
    expect((manifest.extensions as { nav: unknown }).nav).toEqual([
      { label: 'Bookings', path: '/admin' },
      { label: 'Services', path: '/admin/services' },
    ]);
  });

  it.each([
    ['//evil.com/x'],
    ['https://evil.com'],
    ['/admin/../secrets'],
    ['/admin/%2e%2e/secrets'],
    ['/admin\\\\x'],
    ['/other'],
    ['/adminx'],
    ['services'],
  ])('refuses the path %s', (path) => {
    const dir = stage({ [APP_TOML]: withNav(`[[extensions.nav]]\nlabel = "X"\npath = "${path}"\n`) });
    expect(() => loadApp(dir)).toThrow(/extensions\.nav\[0\]\.path/);
  });

  it('refuses a long label, more than 10 items, and nav without a merchant page', () => {
    const long = stage({ [APP_TOML]: withNav(`[[extensions.nav]]\nlabel = "${'x'.repeat(41)}"\npath = "/admin"\n`) });
    expect(() => loadApp(long)).toThrow(/label/);
    const many = Array.from({ length: 11 }, (_, i) => `[[extensions.nav]]\nlabel = "N${i}"\npath = "/admin/n${i}"\n`).join('\n');
    expect(() => loadApp(stage({ [APP_TOML]: withNav(many) }))).toThrow(/more than 10/);
    const noPage = stage({ [APP_TOML]: `${BASE}\n[[extensions.nav]]\nlabel = "X"\npath = "/x"\n` });
    expect(() => loadApp(noPage)).toThrow(/merchant_page_url/);
  });
});
