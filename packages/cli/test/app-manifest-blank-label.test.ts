import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_TOML, loadTomlFile, toManifest } from '../src/lib/app-manifest.js';

// CLI-only parity cases: the deploy route trims every string (Laravel `Str::trim`, which also
// strips no-break and zero-width spaces) and reads an empty one as missing, so a blank schema
// label is refused for EVERY field type, not only line_text.
// The shared line-text-parity fixture stays untouched (backend copy is identical).

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

function extensionDoc(field: Record<string, unknown>): Record<string, unknown> {
  const dir = mkdtempSync(join(tmpdir(), 'app-toml-'));
  dirs.push(dir);
  writeFileSync(join(dir, APP_TOML), BASE);
  const doc = loadTomlFile(join(dir, APP_TOML)).doc;
  doc.extensions = {
    proxy: { url: 'https://x.example.com/p', subpath: 'hello', allow_post: true },
    blocks: [{ key: 'recs', title: 'Recs', targets: ['product'], schema: [field] }],
  };
  return doc;
}

function dashboardDoc(field: Record<string, unknown>): Record<string, unknown> {
  const doc = extensionDoc({ key: 'when', label: 'When', type: 'date' });
  delete doc.extensions;
  doc.dashboard = { blocks: [{ key: 'b', title: 'B', target: 'order-details', schema: [field] }] };
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

const BLANK_LABELS: [string, string][] = [
  ['empty', ''],
  ['spaces', '   '],
  ['tab', '\t'],
  ['newline', '\n'],
  ['carriage return', '\r'],
  ['NUL', '\0'],
  ['vertical tab', '\x0B'],
  ['every PHP trim character', ' \t\n\r\0\x0B'],
];

const FIELDS: [string, Record<string, unknown>][] = [
  ['date', { key: 'when', type: 'date' }],
  ['time', { key: 'at', type: 'time' }],
  ['select', { key: 'size', type: 'select', options: ['S', 'M'] }],
  ['submit', { key: 'send', type: 'submit' }],
];

describe('a blank schema label (server rule: Laravel required, PHP trim, any field type)', () => {
  describe.each(FIELDS)('extension block %s field', (kind, field) => {
    it.each(BLANK_LABELS)('refuses a %s label', (_name, label) => {
      expect(failure(extensionDoc({ ...field, label }))).toMatch(/^The manifest\.extensions\.blocks\[0\]\.schema\[0\]\.label must not be empty\.$/);
    });

    it('accepts a real label, including one with surrounding spaces', () => {
      expect(failure(extensionDoc({ ...field, label: 'Pick one' }))).toBeNull();
      expect(failure(extensionDoc({ ...field, label: '  Pick one ' }))).toBeNull();
    });

    it('refuses a label of only no-break or zero-width spaces: the deploy route trims them before it validates', () => {
      expect(failure(extensionDoc({ ...field, label: '\u00A0' }))).toMatch(/label must not be empty\.$/);
      expect(failure(extensionDoc({ ...field, label: '\u200B' }))).toMatch(/label must not be empty\.$/);
    });

    it('accepts a label with such a space inside, or trimmed to something', () => {
      expect(failure(extensionDoc({ ...field, label: 'A\u00A0B' }))).toBeNull();
      expect(failure(extensionDoc({ ...field, label: '\u200BPick one\u00A0' }))).toBeNull();
    });
  });

  it('refuses a blank label on a dashboard block field too', () => {
    expect(failure(dashboardDoc({ key: 'when', label: ' ', type: 'date' }))).toMatch(/^The manifest\.dashboard\.blocks\.schema\[0\]\.label must not be empty\.$/);
    expect(failure(dashboardDoc({ key: 'when', label: 'When', type: 'date' }))).toBeNull();
  });

  it('reports a blank label once, next to any other problem on the field', () => {
    const message = failure(extensionDoc({ key: 'size', label: '', type: 'select', options: [] })) ?? '';
    expect(message.split('\n').filter((line) => line.includes('label must not be empty'))).toHaveLength(1);
    expect(message).toContain('A select primitive needs at least one option.');
  });
});
