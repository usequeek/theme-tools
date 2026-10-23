import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import { APP_TOML, fromManifest, loadApp, loadTomlFile, serverString, toManifest } from '../src/lib/app-manifest.js';

// Shopper account manifest contract (`app_page`, `account-page`, `account-order`),
// mirrored from the API's validator. The rows live in a CLI-side fixture so the
// shared line-text-parity fixture stays untouched.

interface Row { name: string; valid: boolean; proxy: Record<string, unknown> | null; blocks: Record<string, unknown>[]; embeds?: Record<string, unknown>[]; contains: string | null; count?: number }
interface VerdictRow { name: string; path: string; value: string; valid: boolean; contains: string | null }
interface ManifestVerdict { name: string; path: string; value: string | { prefix: string; unit: string; count: number; suffix: string }; valid: boolean }
interface FieldRow { name: string; field: string; value: string; valid: boolean; contains: string | null }
interface TitleRow { name: string; title: string; valid: boolean }
const parity = JSON.parse(readFileSync(new URL('./fixtures/account-manifest-parity.json', import.meta.url), 'utf8')) as { rows: Row[]; titles: TitleRow[]; fields: FieldRow[]; serverVerdicts: VerdictRow[]; serverTrimmedCodePoints: number[]; manifestBase: Record<string, unknown>; manifestVerdicts: ManifestVerdict[] };

const BASE = `
slug = "bookings"
name = "Bookings"

[access]
scopes = ["merchant-business_profile-read"]

[app]
install_url = "https://apps.example.com/bookings/install"
uninstall_url = "https://apps.example.com/bookings/uninstall"
`;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function stage(toml: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'app-toml-'));
  dirs.push(dir);
  writeFileSync(join(dir, APP_TOML), toml);
  return dir;
}

function docFor(proxy: Record<string, unknown> | null, blocks: unknown[], embeds?: unknown[]): Record<string, unknown> {
  const doc = loadTomlFile(join(stage(BASE), APP_TOML)).doc;
  doc.extensions = { ...(proxy ? { proxy } : {}), blocks, ...(embeds ? { embeds } : {}) };
  return doc;
}

function failure(doc: Record<string, unknown>): string | null {
  try {
    toManifest(doc);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

const PROXY = { url: 'https://apps.example.com/bookings/proxy', subpath: 'bookings', share_customer_id: true };
const page = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ key: 'my_bookings', type: 'app_page', title: 'My bookings', targets: ['account-page'], url: 'https://apps.example.com/bookings/account', ...extra });
const order = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ key: 'order_booking', title: 'Booking', targets: ['account-order'], ...extra });

describe('shopper account manifest parity fixture', () => {
  it('carries the full mirrored table', () => {
    expect(parity.rows.length).toBeGreaterThanOrEqual(45);
    expect(parity.rows.some((row) => row.valid)).toBe(true);
    expect(parity.titles.length).toBeGreaterThanOrEqual(45);
  });

  it.each(parity.rows.map((row) => [row.name, row] as const))('row: %s', (_name, row) => {
    const message = failure(docFor(row.proxy, row.blocks, row.embeds));
    if (row.valid) {
      expect(message).toBeNull();
      return;
    }
    expect(message).not.toBeNull();
    expect(message).toContain(row.contains as string);
    if (row.count !== undefined) expect((message as string).split('\n')).toHaveLength(row.count);
  });

  it.each(parity.fields.map((row) => [row.name, row] as const))('listing field: %s', (_name, row) => {
    const doc = loadTomlFile(join(stage(BASE), APP_TOML)).doc;
    doc.listing = { [row.field]: row.value };
    const message = failure(doc);
    if (row.valid) {
      expect(message).toBeNull();
      return;
    }
    expect(message).toContain(`The ${row.field} ${row.contains as string}`);
  });

  it('refuses a non-string logo_url or link, as the API string rule does', () => {
    const doc = loadTomlFile(join(stage(BASE), APP_TOML)).doc;
    doc.listing = { support_url: 5 };
    expect(failure(doc)).toBe('The support_url field must be a string.');
  });

  describe.each([
    ['app_page', (title: string) => page({ title })],
    ['account-order block', (title: string) => order({ title })],
  ])('title on an %s', (_kind, make) => {
    it.each(parity.titles.map((row) => [row.name, row] as const))('title: %s', (_name, row) => {
      const message = failure(docFor(PROXY, [make(row.title)]));
      if (row.valid) {
        expect(message).toBeNull();
        return;
      }
      // An all-blank title is the plain `required` refusal, as on the API.
      expect(message).toMatch(/extensions\.blocks\[0\]\.title (must be 1-40 characters|field is required)/);
    });
  });
});

describe('what the API middleware does to a url string before it validates (trim, empty reads as absent)', () => {
  const trimmed = new Set(parity.serverTrimmedCodePoints);

  it('trims exactly the code points the API trims, over every code point', () => {
    const wrong: string[] = [];
    for (let code = 0; code <= 0x10ffff; code += 1) {
      if (code >= 0xd800 && code <= 0xdfff) continue;
      const stripped = serverString(`a${String.fromCodePoint(code)}`) === 'a';
      if (stripped !== trimmed.has(code)) wrong.push(code.toString(16));
    }
    expect(wrong).toEqual([]);
  });

  it('reads an empty result as absent, keeps interior whitespace and passes non-strings through', () => {
    expect(serverString('')).toBeUndefined();
    expect(serverString(' \t​﻿')).toBeUndefined();
    expect(serverString(' https://x.example.com/a b ')).toBe('https://x.example.com/a b');
    expect(serverString(5)).toBe(5);
  });

  const section = (doc: Record<string, unknown>, name: string): Record<string, unknown> => {
    doc[name] ??= {};
    return doc[name] as Record<string, unknown>;
  };
  const docWith = (path: string, value: string): Record<string, unknown> => {
    const doc = loadTomlFile(join(stage(BASE), APP_TOML)).doc;
    doc.extensions = {
      proxy: PROXY,
      blocks: [page(), { key: 'promo', title: 'Promo', targets: ['product'] }],
      embeds: [{ key: 'chat', title: 'Chat', target: 'body', url: 'https://apps.example.com/chat', capabilities: ['chat-bubble'] }],
    };
    doc.dashboard = { actions: [{ key: 'a', title: 'A', target: 'order-details', scope: 'merchant-business_profile-read', effect: 'order_appointment', notify_url: 'https://apps.example.com/n' }] };
    const ext = doc.extensions as { proxy: Record<string, unknown>; blocks: Record<string, unknown>[]; embeds: Record<string, unknown>[]; merchant_page_url?: string };
    const parts = path.split('.');
    if (['logo_url', 'developer_url', 'privacy_url', 'support_url', 'demo_url', 'video_url'].includes(path)) section(doc, 'listing')[path] = value;
    else if (['install_url', 'uninstall_url', 'settings_url'].includes(path)) section(doc, 'app')[path] = value;
    else if (path === 'webhook_url') section(doc, 'webhooks').url = value;
    else if (path === 'extensions.proxy.url') ext.proxy = { ...PROXY, url: value };
    else if (path === 'extensions.merchant_page_url') ext.merchant_page_url = value;
    else if (parts[1] === 'blocks' && parts[3] === 'image') ext.blocks[Number(parts[2])].image = { url: value };
    else if (parts[1] === 'blocks') ext.blocks[Number(parts[2])][parts[3]] = value;
    else if (parts[1] === 'embeds') ext.embeds[0].url = value;
    else if (parts[0] === 'dashboard') ((doc.dashboard as { actions: Record<string, unknown>[] }).actions[0]).notify_url = value;
    else throw new Error(`unmapped path ${path}`);
    return doc;
  };

  it('has the full server verdict table', () => {
    expect(parity.serverVerdicts.length).toBeGreaterThanOrEqual(90);
  });

  it.each(parity.serverVerdicts.map((row) => [row.name, row] as const))('server verdict: %s', (_name, row) => {
    const message = failure(docWith(row.path, row.value));
    if (row.valid) {
      expect(message).toBeNull();
      return;
    }
    expect(message).not.toBeNull();
    if (row.contains) expect(message).toContain(row.contains);
  });
});

describe('every string is read the way the API reads it (trimmed, empty is unset, caps count code points)', () => {
  const setPath = (target: Record<string, unknown>, path: string, value: unknown): void => {
    const parts = path.split('.');
    let node: Record<string, unknown> = target;
    parts.slice(0, -1).forEach((part, index) => {
      node[part] ??= /^\d+$/.test(parts[index + 1]) ? [] : {};
      node = node[part] as Record<string, unknown>;
    });
    node[parts[parts.length - 1]] = value;
  };
  const resolve = (value: ManifestVerdict['value']): string => (typeof value === 'string' ? value : `${value.prefix}${value.unit.repeat(value.count)}${value.suffix}`);
  const answer = (path: string, value: string): string | null => {
    const manifest = structuredClone(parity.manifestBase);
    if (path) setPath(manifest, path, value);
    return failure(parseToml(fromManifest(manifest)) as Record<string, unknown>);
  };

  it('accepts the unchanged base manifest and has the full API verdict table', () => {
    expect(answer('', '')).toBeNull();
    expect(parity.manifestVerdicts.length).toBeGreaterThanOrEqual(350);
    expect(parity.manifestVerdicts.some((row) => row.valid)).toBe(true);
    expect(parity.manifestVerdicts.some((row) => !row.valid)).toBe(true);
  });

  it.each(parity.manifestVerdicts.map((row) => [row.name, row] as const))('API verdict: %s', (_name, row) => {
    const message = answer(row.path, resolve(row.value));
    if (row.valid) expect(message).toBeNull();
    else expect(message).not.toBeNull();
  });

  it('reports a cap breach with the field named, and an empty required field as missing', () => {
    expect(answer('name', 'a'.repeat(121))).toBe('The name field is required (max 120).');
    expect(answer('name', ' \t')).toBe('The name field is required.');
    expect(answer('slug', ' ')).toBe('The slug must be 2-64 lowercase letters, digits or dashes.');
    expect(answer('distribution', '')).toBe('The distribution field must be a string.');
    expect(answer('extensions.blocks.1.type', ' ')).toBe('The extensions.blocks[1].type field must be a string.');
    expect(answer('scopes.0', '  ')).toBe('The access.scopes[0] field is required.');
  });

  it('sends the trimmed values', () => {
    const manifest = structuredClone(parity.manifestBase);
    manifest.slug = '  bookings\n';
    manifest.icon = ' ';
    const { manifest: sent } = toManifest(parseToml(fromManifest(manifest)) as Record<string, unknown>);
    expect(sent.slug).toBe('bookings');
    expect(sent.icon).toBeUndefined();
  });
});

describe('shopper account manifest messages', () => {
  it('keeps the unknown-field refusal, exactly, for a url on any block that is not an app_page', () => {
    for (const block of [
      { key: 'p', title: 'P', targets: ['product'], url: 'https://apps.example.com/x' },
      { key: 'p', title: 'P', targets: ['product'], url: 5 },
      { key: 'p', title: 'P', targets: ['product'], url: '' },
      { key: 'p', type: 'app_embed', title: 'P', targets: ['product'], url: 'https://apps.example.com/x' },
      order({ url: 'https://apps.example.com/x' }),
    ]) {
      expect(failure(docFor(PROXY, [block]))).toBe("Unknown field 'url' in manifest.extensions.blocks[0].");
    }
  });

  it('names the whole target and type lists', () => {
    expect(failure(docFor(PROXY, [order({ targets: ['cart'] })]))).toBe('The block target must be one of: product, account-page, account-order.');
    expect(failure(docFor(PROXY, [order({ type: 'bogus' })]))).toBe('The block type must be one of: app_block, app_embed, app_page.');
  });

  it('reports the proxy requirement, the https rule and the origin rule in the API wording', () => {
    expect(failure(docFor({ ...PROXY, share_customer_id: undefined }, [page()]))).toBe('An account page or account block needs extensions.proxy with share_customer_id: true.');
    expect(failure(docFor(PROXY, [page({ url: 'http://apps.example.com/a' })]))).toBe('The manifest.extensions.blocks[0].url must be an https URL.');
    expect(failure(docFor(PROXY, [page({ url: 'https://dashboard.usequeek.com/a' })]))).toBe(
      "The manifest.extensions.blocks[0].url must be on the app's own domain — never a Queek domain or one that shares its cookies.",
    );
  });

  it('reports a fragment and credentials together with the https refusal, and stops before the origin rule', () => {
    expect(failure(docFor(PROXY, [page({ url: 'http://u:p@dashboard.usequeek.com/a#x' })])).split('\n')).toEqual([
      'The manifest.extensions.blocks[0].url must not contain a fragment.',
      'The manifest.extensions.blocks[0].url must not contain credentials.',
      'The manifest.extensions.blocks[0].url must be an https URL.',
    ]);
  });

  it('accepts only true, false, 1, 0 or their strings for share_customer_id, as Laravel booleans do', () => {
    expect(failure(docFor({ ...PROXY, share_customer_id: 'yes' }, [page()]))).toBe('The extensions.proxy.share_customer_id field must be true or false.');
    expect(failure(docFor({ ...PROXY, share_customer_id: 1 }, [page()]))).toBeNull();
    expect(failure(docFor({ ...PROXY, share_customer_id: '1' }, [page()]))).toBeNull();
    expect(failure(docFor({ ...PROXY, share_customer_id: 0 }, [page()]))).toContain('share_customer_id: true');
  });

  it('refuses a page url over 2048 characters and a non-string url, before any account rule', () => {
    expect(failure(docFor(PROXY, [page({ url: `https://apps.example.com/${'a'.repeat(2048)}` })]))).toBe('The manifest.extensions.blocks[0].url must not be longer than 2048 characters.');
    expect(failure(docFor(PROXY, [page({ url: 5 })]))).toBe('The manifest.extensions.blocks[0].url field must be a string.');
  });

  it('holds the account rules back while an earlier refusal stands, like the API', () => {
    expect(failure(docFor(null, [order({ url: 'https://apps.example.com/x' })]))).toBe("Unknown field 'url' in manifest.extensions.blocks[0].");
  });

  it('refuses a blank block title for every block, as the API `required` rule does', () => {
    expect(failure(docFor(PROXY, [{ key: 'p', title: '  ', targets: ['product'] }]))).toBe('The manifest.extensions.blocks[0].title field is required (max 80).');
  });

  it('reports a repeated block key once, and only when no account refusal stands', () => {
    expect(failure(docFor(PROXY, [order(), order()]))).toBe('A manifest may declare at most 1 account order block.');
    expect(failure(docFor(PROXY, [{ key: 'p', title: 'P', targets: ['product'] }, { key: 'p', title: 'Q', targets: ['product'] }]))).toBe('Extension block keys must be unique.');
  });

  it('counts the block title cap in code points, as the API does (not UTF-16 units)', () => {
    const product = (title: string): Record<string, unknown> => ({ key: 'p', title, targets: ['product'] });
    const cap = 'The manifest.extensions.blocks[0].title field is required (max 80).';
    expect(failure(docFor(null, [product('\u{1F4C5}'.repeat(41))]))).toBeNull();
    expect(failure(docFor(null, [product('\u{1F4C5}'.repeat(80))]))).toBeNull();
    expect(failure(docFor(null, [product('\u{1F4C5}'.repeat(81))]))).toBe(cap);
    expect(failure(docFor(null, [product('e\u0301'.repeat(40))]))).toBeNull();
    expect(failure(docFor(null, [product(`a${'\u0301'.repeat(80)}`)]))).toBe(cap);
    expect(failure(docFor(null, [product('a'.repeat(80))]))).toBeNull();
    expect(failure(docFor(null, [product('a'.repeat(81))]))).toBe(cap);
  });

  it('does not apply the account title rule to product blocks', () => {
    expect(failure(docFor(null, [{ key: 'p', title: 'Pick​er‮', targets: ['product'] }]))).toBeNull();
  });

  it('sends an accepted manifest through unchanged (blocks as written, page url kept)', () => {
    const { manifest } = toManifest(docFor(PROXY, [page(), order()]));
    const blocks = (manifest.extensions as { blocks: Record<string, unknown>[] }).blocks;
    expect(blocks[0]).toMatchObject({ type: 'app_page', targets: ['account-page'], url: 'https://apps.example.com/bookings/account' });
    expect(blocks[1]).not.toHaveProperty('url');
  });
});

describe('urls with control characters, whitespace, invisible characters or a backslash', () => {
  const UNSAFE = 'must not contain control characters, whitespace, invisible characters or a backslash in the host.';
  const bad = 'https://apps.example.com/a b';
  const ext = (doc: Record<string, unknown>): Record<string, unknown> => doc.extensions as Record<string, unknown>;
  const withDoc = (mutate: (doc: Record<string, unknown>) => void): string | null => {
    const doc = docFor(PROXY, []);
    mutate(doc);
    return failure(doc);
  };

  it('refuses it on every top-level url field the CLI checks, naming the field', () => {
    const cases: [string, string][] = [
      ['install_url', BASE.replace('https://apps.example.com/bookings/install', bad)],
      ['uninstall_url', BASE.replace('https://apps.example.com/bookings/uninstall', bad)],
      ['settings_url', BASE.replace('[app]\n', `[app]\nsettings_url = "${bad}"\n`)],
      ['webhook_url', `${BASE}\n[webhooks]\nurl = "${bad}"\n`],
      ['demo_url', `${BASE}\n[listing]\ndemo_url = "${bad}"\n`],
      ['extensions.merchant_page_url', `${BASE}\n[extensions]\nmerchant_page_url = "${bad}"\n`],
    ];
    for (const [field, source] of cases) {
      expect(() => loadApp(stage(source)), field).toThrow(`The ${field} ${UNSAFE}`);
    }
  });

  it('refuses it on the embed, the block image and link, the proxy and a dashboard action', () => {
    const embed = { key: 'chat', title: 'Chat', target: 'body', url: 'https://apps.example.com/chat‍x', capabilities: ['chat-bubble'] };
    expect(withDoc((doc) => { ext(doc).embeds = [embed]; })).toBe(`The manifest.extensions.embeds[0].url ${UNSAFE}`);
    expect(withDoc((doc) => { ext(doc).proxy = { ...PROXY, url: 'https://apps.example.com/p\tq' }; })).toBe(`The extensions.proxy.url ${UNSAFE}`);
    expect(withDoc((doc) => { ext(doc).blocks = [{ key: 'p', title: 'P', targets: ['product'], link_url: bad }]; })).toBe(`The manifest.extensions.blocks[0].link_url ${UNSAFE}`);
    expect(withDoc((doc) => { ext(doc).blocks = [{ key: 'p', title: 'P', targets: ['product'], image: { url: bad } }]; })).toBe(`The manifest.extensions.blocks[0].image.url ${UNSAFE}`);
    const message = withDoc((doc) => {
      delete doc.extensions;
      doc.dashboard = { actions: [{ key: 'a', title: 'A', target: 'order-details', scope: 'merchant-business_profile-read', effect: 'order_appointment', notify_url: bad }] };
    });
    expect(message).toContain(`notify_url ${UNSAFE}`);
  });

  it('keeps the https refusal first on a generic field and the unsafe refusal first on the page url, as the API does', () => {
    expect(withDoc((doc) => { ext(doc).proxy = { ...PROXY, url: 'http://apps.example.com/a b' }; })).toBe('The extensions.proxy.url must be an https URL.');
    expect(failure(docFor(PROXY, [page({ url: 'http://apps.example.com/a b' })]))).toBe(`The manifest.extensions.blocks[0].url ${UNSAFE}`);
  });

  it('refuses a backslash in the authority only; in the path, query or fragment it stays accepted, as on the API', () => {
    expect(failure(docFor(PROXY, [page({ url: 'https://apps.example.com\\.evil.example/' })]))).toBe(`The manifest.extensions.blocks[0].url ${UNSAFE}`);
    expect(failure(docFor(PROXY, [page({ url: 'https://apps.example.com/a\\b' })]))).toBeNull();
    expect(failure(docFor(PROXY, [page({ url: 'https://apps.example.com/a?x=a\\b' })]))).toBeNull();
    expect(withDoc((doc) => { ext(doc).blocks = [{ key: 'p', title: 'P', targets: ['product'], link_url: 'https://apps.example.com/a#x\\y' }]; })).toBeNull();
  });

  it('accepts an internationalised host, a query string and a plain https url', () => {
    expect(failure(docFor(PROXY, [page({ url: 'https://bücher.example.com/konto?x=1&y=a%20b' })]))).toBeNull();
    expect(withDoc((doc) => { ext(doc).blocks = [{ key: 'p', title: 'P', targets: ['product'], link_url: 'https://apps.example.com/a?x=1' }]; })).toBeNull();
  });
});

describe('queek.app.toml with a shopper account page', () => {
  const ACCOUNT_TOML = `${BASE}
[extensions.proxy]
url = "https://apps.example.com/bookings/proxy"
subpath = "bookings"
share_customer_id = true

[[extensions.blocks]]
key = "my_bookings"
type = "app_page"
title = "My bookings"
targets = ["account-page"]
url = "https://apps.example.com/bookings/account"

[[extensions.blocks]]
key = "order_booking"
title = "Booking"
targets = ["account-order"]
`;

  it('loads a page and an order block from the toml file', () => {
    const { manifest } = loadApp(stage(ACCOUNT_TOML));
    expect((manifest.extensions as { blocks: unknown[] }).blocks).toHaveLength(2);
  });

  it('refuses the same toml without share_customer_id, naming the field', () => {
    expect(() => loadApp(stage(ACCOUNT_TOML.replace('share_customer_id = true\n', '')))).toThrow('share_customer_id: true');
  });

  it('refuses a toml title with an interior newline, and trims a trailing one like the API (TOML multi-line string)', () => {
    expect(() => loadApp(stage(ACCOUNT_TOML.replace('title = "My bookings"', 'title = """My\nbookings"""')))).toThrow('title must be 1-40 characters');
    expect(() => loadApp(stage(ACCOUNT_TOML.replace('title = "My bookings"', 'title = """My bookings\n"""')))).not.toThrow();
  });
});
