import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setupApp } from '../src/setup.js';
import { slugProblem, slugify } from '../src/naming.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('@usequeek/create-app', () => {
  it('slugifies display names to backend slugs', () => {
    expect(slugify('My App & Co.')).toBe('my-app-co');
    expect(slugProblem('hello')).toBeNull();
    expect(slugProblem('Hello!')).toContain('2 to 64');
    expect(slugProblem('a')).toContain('2 to 64');
  });

  it('renames the starter toml + package to the new slug', () => {
    const stage = mkdtempSync(join(tmpdir(), 'starter-'));
    dirs.push(stage);
    writeFileSync(join(stage, 'queek.app.toml'), 'slug = "hello"\nname = "Hello"\n\n[app]\ninstall_url = "https://my-app.apps.queek.com.ng/install"\n');
    writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: '@usequeek/app-starter', version: '0.1.0' }));
    writeFileSync(join(stage, 'README.md'), '# Hello\n');
    mkdirSync(join(stage, 'src'), { recursive: true });
    writeFileSync(join(stage, 'src', 'config.ts'), 'export const APP_SLUG = "my-app";\nexport const DEFAULT_BASE_URL = "https://my-app.apps.queek.com.ng";\n');
    setupApp(stage, { slug: 'bookings', name: 'Bookings' });
    expect(readFileSync(join(stage, 'queek.app.toml'), 'utf8')).toContain('slug = "bookings"');
    expect(readFileSync(join(stage, 'queek.app.toml'), 'utf8')).toContain('name = "Bookings"');
    expect(readFileSync(join(stage, 'queek.app.toml'), 'utf8')).toContain('https://bookings.apps.queek.com.ng/install');
    expect(readFileSync(join(stage, 'src', 'config.ts'), 'utf8')).toContain('APP_SLUG = "bookings"');
    expect(readFileSync(join(stage, 'src', 'config.ts'), 'utf8')).toContain('https://bookings.apps.queek.com.ng');
    expect(JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8')).name).toBe('bookings');
    expect(readFileSync(join(stage, 'README.md'), 'utf8')).toContain('# Bookings');
  });

  it('refuses a stage without queek.app.toml', () => {
    const stage = mkdtempSync(join(tmpdir(), 'starter-'));
    dirs.push(stage);
    expect(() => setupApp(stage, { slug: 'my-app', name: 'My App' })).toThrow('queek.app.toml');
  });
});
