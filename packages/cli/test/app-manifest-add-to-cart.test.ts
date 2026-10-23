import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import { APP_TOML, fromManifest, loadApp, loadTomlFile, toManifest } from '../src/lib/app-manifest.js';

// The `add_to_cart` block field (the price-neutral add-to-cart button of a product page block), mirrored
// from the API's validator. Two fixtures:
//  - add-to-cart-parity.json: the API's own table, a byte-identical copy (its sha256 is pinned below to the
//    constant the API's test pins, so a re-copy that drifts fails here).
//  - add-to-cart-route-parity.json: the verdicts of the REAL API stack (TrimStrings and
//    ConvertEmptyStringsToNull, then the validator) for every row of that table and for CLI-sensitive rows of
//    our own. The deploy route trims every string before the validator sees it, so these are the verdicts the
//    CLI must reproduce.

const FIXTURE_SHA256 = 'e57daa7756b6219c20b5f845e52019d969f264711e984c1249bdca631a8097a6';

interface FixtureRow { name: string; slug: string; proxy: boolean; valid: boolean; rule: string | null; blocks: unknown[] }
interface Verdict { name: string; valid: boolean; messages: string[] }
interface OwnRow extends Verdict { slug: string; extensions: unknown; dashboard?: unknown }

const read = (name: string): Buffer => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const fixtureBytes = read('add-to-cart-parity.json');
const fixture = JSON.parse(fixtureBytes.toString('utf8')) as { rows: FixtureRow[] };
const route = JSON.parse(read('add-to-cart-route-parity.json').toString('utf8')) as { fixtureRows: Verdict[]; rows: OwnRow[] };

const BASE = `
slug = "my-app"
name = "Pack App"

[access]
scopes = ["merchant-business_profile-read", "merchant-orders-read"]

[app]
install_url = "https://apps.example.com/pack/install"
uninstall_url = "https://apps.example.com/pack/uninstall"
`;
const PROXY = { url: 'https://apps.example.com/pack/proxy', subpath: 'pack' };

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

function docFor(slug: string, extensions: unknown, dashboard?: unknown): Record<string, unknown> {
  const doc = parseToml(BASE) as Record<string, unknown>;
  doc.slug = slug;
  doc.extensions = extensions;
  if (dashboard !== undefined) doc.dashboard = dashboard;
  return structuredClone(doc);
}

/** The CLI's refusal as lines, or null when the manifest is accepted. */
function failure(doc: Record<string, unknown>): string[] | null {
  try {
    toManifest(doc);
    return null;
  } catch (error) {
    return (error as Error).message.split('\n');
  }
}

const fixtureDoc = (row: FixtureRow): Record<string, unknown> => docFor(row.slug, { ...(row.proxy ? { proxy: PROXY } : {}), blocks: row.blocks });

/** The refusal lines this rule owns (the API words them identically; only the `manifest.` path prefix is the CLI's). */
const OWNED = /add_to_cart field|must be 1-40 characters/;
const owned = (lines: string[]): string[] => lines.map((line) => line.replace(/\bmanifest\./g, '')).filter((line) => OWNED.test(line));

/** Each refusal rule of the API's table, as the message shapes the validator gives for it. */
const RULE_MESSAGES: Record<string, RegExp[]> = {
  exactly_one_field: [/schema must hold exactly one add_to_cart field and nothing else\.$/],
  product_target_only: [/must be an app_block with exactly the product target\.$/, /^The block target must be one of: /],
  field_not_valid: [/schema\[\d+\]\.(required|options) is not valid on an add_to_cart field\.$/],
  max_length_placement: [/max_length is only valid on a line_text field\.$/],
  label: [/schema\[\d+\]\.label must be 1-40 characters with no control, zero-width or direction-override characters\.$/, /label must not be empty\.$/],
  title: [/\]\.title must be 1-40 characters with no control, zero-width or direction-override characters\.$/, /\.title field is required \(max 80\)\.$/],
  needs_proxy: [/needs extensions\.proxy: the products come from its signed read\.$/],
  block_cap: [/^A manifest may declare at most 2 blocks with an add_to_cart field\.$/],
};

/**
 * Rows whose validator-only verdict in the API's table differs from the real route: the route trims every
 * string first (spaces, newlines, and the zero-width, byte-order-mark and Mongolian-vowel-separator edges), so
 * a padded title or label is accepted there. Verified against the real stack (see the route fixture).
 */
const ROUTE_ACCEPTS = [
  'refuses U+2028 line separator in the title',
  'refuses U+2060 word joiner in the title',
  'refuses U+FEFF byte order mark in the title',
  'refuses U+180E Mongolian vowel separator in the title',
  'refuses a trailing newline in the label',
  'refuses a trailing newline in the title',
];

describe('add_to_cart parity: the API table', () => {
  it('is the API table byte for byte (sha256 equals the constant the API test pins)', () => {
    expect(createHash('sha256').update(fixtureBytes).digest('hex')).toBe(FIXTURE_SHA256);
    expect(fixture.rows).toHaveLength(51);
    expect(route.fixtureRows.map((row) => row.name)).toEqual(fixture.rows.map((row) => row.name));
    expect(Object.keys(RULE_MESSAGES).sort()).toEqual([...new Set(fixture.rows.map((row) => row.rule).filter(Boolean))].sort());
  });

  it('differs from the route on exactly the known rows', () => {
    const different = fixture.rows.filter((row, index) => row.valid !== route.fixtureRows[index].valid).map((row) => row.name);
    expect(different).toEqual(ROUTE_ACCEPTS);
  });

  it.each(fixture.rows.map((row, index) => [row.name, row, route.fixtureRows[index]] as const))('row: %s', (_name, row, verdict) => {
    const lines = failure(fixtureDoc(row));
    expect(lines === null, (lines ?? []).join('\n')).toBe(verdict.valid);
    if (lines === null || ROUTE_ACCEPTS.includes(row.name)) return;
    // A refused row fails ONLY for its stated rule (any of that rule's message shapes).
    const patterns = RULE_MESSAGES[row.rule as string];
    for (const line of lines) expect(patterns.some((pattern) => pattern.test(line.replace(/\bmanifest\./g, ''))), line).toBe(true);
  });
});

/**
 * The API stops at its first refusing stage (the field rules, then an unknown key, then these block rules); the CLI
 * lists every refusal at once. The verdict is identical, only these rows carry extra lines on the CLI side.
 */
const EARLIER_STAGE_ROWS = ['unknown key in the field and a second field'];

describe('add_to_cart parity: the real API stack', () => {
  it('carries the full table', () => {
    expect(route.rows.length).toBeGreaterThanOrEqual(200);
    expect(route.rows.filter((row) => row.valid).length).toBeGreaterThan(50);
    expect(route.rows.filter((row) => !row.valid).length).toBeGreaterThan(100);
  });

  it.each(route.rows.map((row) => [row.name, row] as const))('row: %s', (_name, row) => {
    const lines = failure(docFor(row.slug, row.extensions, row.dashboard));
    expect(lines === null, (lines ?? []).join('\n')).toBe(row.valid);
    // The add_to_cart lines the API gives are the ones the CLI gives (same words, same order).
    if (lines !== null && !EARLIER_STAGE_ROWS.includes(row.name)) expect(owned(lines)).toEqual(owned(row.messages));
  });
});

describe('add_to_cart in queek.app.toml', () => {
  const toml = (extra = ''): string => `${BASE}
[extensions.proxy]
url = "https://apps.example.com/pack/proxy"
subpath = "pack"

[[extensions.blocks]]
key = "add_pack"
title = "Starter kit"
targets = ["product"]

[[extensions.blocks.schema]]
key = "add"
label = "Add the starter kit"
type = "add_to_cart"
${extra}`;

  it('accepts the field and sends it as written', () => {
    const { manifest, warnings } = toManifest(loadTomlFile(join(stage(toml()), APP_TOML)).doc);
    expect(warnings).toEqual([]);
    expect((manifest.extensions as { blocks: { schema: unknown[] }[] }).blocks[0].schema).toEqual([{ key: 'add', label: 'Add the starter kit', type: 'add_to_cart' }]);
  });

  it('refuses a required flag, a second field and a missing proxy with the API wording', () => {
    const refused = (text: string): string => {
      try {
        toManifest(loadTomlFile(join(stage(text), APP_TOML)).doc);
        return 'no error';
      } catch (error) {
        return (error as Error).message;
      }
    };
    expect(refused(toml('required = false\n'))).toContain('schema[0].required is not valid on an add_to_cart field.');
    expect(refused(`${toml()}\n[[extensions.blocks.schema]]\nkey = "d"\nlabel = "D"\ntype = "date"\n`)).toContain('schema must hold exactly one add_to_cart field and nothing else.');
    expect(refused(toml().replace(/\[extensions\.proxy\][^[]*/, ''))).toContain('needs extensions.proxy: the products come from its signed read.');
  });

  it('round-trips through fromManifest, the toml text and back', () => {
    const { manifest } = toManifest(loadTomlFile(join(stage(toml()), APP_TOML)).doc);
    const text = fromManifest(manifest as unknown as Record<string, unknown>);
    expect(text).toContain('type = "add_to_cart"');
    const again = toManifest(loadTomlFile(join(stage(text), APP_TOML)).doc).manifest;
    expect(again.extensions).toEqual(manifest.extensions);
    expect(fromManifest(again as unknown as Record<string, unknown>)).toBe(text);
  });

  it('loads through loadApp', () => {
    const { manifest } = loadApp(stage(toml()));
    expect((manifest.extensions as { blocks: unknown[] }).blocks).toHaveLength(1);
  });

  it('does not name the type in the unknown-primitive message (the API names it only while its platform switch is on)', () => {
    const bad = toml().replace('type = "add_to_cart"', 'type = "cart"');
    expect(() => toManifest(loadTomlFile(join(stage(bad), APP_TOML)).doc)).toThrow('The schema primitive must be one of: date, time, select, submit, line_text.');
  });
});
