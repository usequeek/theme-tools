import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fetchStarter, setupApp } from '../src/setup.js';
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
    writeFileSync(join(stage, 'src', 'config.ts'), 'export const APP_SLUG = "my-app";\nexport const DEFAULT_BASE_URL = "https://my-app.apps.queek.com.ng";\n    dbPath: "./data/my-app.db",\n');
    writeFileSync(join(stage, 'README.md'), '# Hello\nhttps://my-app.apps.queek.com.ng/install\n');
    writeFileSync(join(stage, 'Dockerfile'), '# docker build -t my-app .\nENV QUEEK_DB_PATH=/app/data/my-app.db\n');
    writeFileSync(join(stage, '.env.example'), 'QUEEK_DB_PATH=./data/my-app.db\n');
    setupApp(stage, { slug: 'bookings', name: 'Bookings' });
    expect(readFileSync(join(stage, 'queek.app.toml'), 'utf8')).toContain('slug = "bookings"');
    expect(readFileSync(join(stage, 'queek.app.toml'), 'utf8')).toContain('name = "Bookings"');
    expect(readFileSync(join(stage, 'queek.app.toml'), 'utf8')).toContain('https://bookings.apps.queek.com.ng/install');
    expect(readFileSync(join(stage, 'src', 'config.ts'), 'utf8')).toContain('APP_SLUG = "bookings"');
    expect(readFileSync(join(stage, 'src', 'config.ts'), 'utf8')).toContain('https://bookings.apps.queek.com.ng');
    expect(readFileSync(join(stage, 'src', 'config.ts'), 'utf8')).toContain('"./data/bookings.db"');
    expect(JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8')).name).toBe('bookings');
    expect(readFileSync(join(stage, 'README.md'), 'utf8')).toContain('# Bookings');
    expect(readFileSync(join(stage, 'README.md'), 'utf8')).toContain('https://bookings.apps.queek.com.ng/install');
    expect(readFileSync(join(stage, 'Dockerfile'), 'utf8')).toContain('docker build -t bookings');
    expect(readFileSync(join(stage, 'Dockerfile'), 'utf8')).toContain('/app/data/bookings.db');
    expect(readFileSync(join(stage, '.env.example'), 'utf8')).toContain('./data/bookings.db');
  });

  it('refuses a stage without queek.app.toml', () => {
    const stage = mkdtempSync(join(tmpdir(), 'starter-'));
    dirs.push(stage);
    expect(() => setupApp(stage, { slug: 'my-app', name: 'My App' })).toThrow('queek.app.toml');
  });

  it('renames the lockfile root instead of leaving the template name', () => {
    const stage = mkdtempSync(join(tmpdir(), 'starter-'));
    dirs.push(stage);
    writeFileSync(join(stage, 'queek.app.toml'), 'slug = "hello"\nname = "Hello"\n');
    writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'my-app' }));
    writeFileSync(join(stage, 'package-lock.json'), JSON.stringify({ name: 'my-app', packages: { '': { name: 'my-app' } } }));
    setupApp(stage, { slug: 'bookings', name: 'Bookings' });
    const lock = JSON.parse(readFileSync(join(stage, 'package-lock.json'), 'utf8')) as { name: string; packages: { '': { name: string } } };
    expect(lock.name).toBe('bookings');
    expect(lock.packages[''].name).toBe('bookings');
  });

  it('never stages history, dependencies, data or secrets from a local template', async () => {
    const source = mkdtempSync(join(tmpdir(), 'template-'));
    dirs.push(source);
    writeFileSync(join(source, 'queek.app.toml'), 'slug = "hello"\nname = "Hello"\n');
    writeFileSync(join(source, '.env.example'), 'APP_BASE_URL=x\n');
    writeFileSync(join(source, '.env'), 'QUEEK_APP_SECRET=live\n');
    for (const junk of ['.git', 'node_modules', 'dist', 'data', '.queek']) {
      mkdirSync(join(source, junk), { recursive: true });
      writeFileSync(join(source, junk, 'junk.txt'), 'junk');
    }
    const into = mkdtempSync(join(tmpdir(), 'staged-'));
    dirs.push(into);
    await fetchStarter(into, source, 'unused');
    expect(existsSync(join(into, 'queek.app.toml'))).toBe(true);
    expect(existsSync(join(into, '.env.example'))).toBe(true);
    for (const junk of ['.git', 'node_modules', 'dist', 'data', '.queek', '.env']) {
      expect(existsSync(join(into, junk))).toBe(false);
    }
  });
});
