import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { assertNodeVersion, fetchStarter, nodeVersionProblem, setupAgentFiles, setupApp, successBanner, sweepTemplateIdentity } from '../src/setup.js';
import { slugProblem, slugify } from '../src/naming.js';

/** Every staged file still carrying the template identity (`my-app`/`My App`). */
function templateLeftovers(stage: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || !statSync(full).isFile()) continue;
      const bytes = readFileSync(full);
      if (bytes.includes(0)) continue;
      const text = bytes.toString('utf8');
      if (text.includes('my-app') || text.includes('My App')) found.push(full);
    }
  };
  walk(stage);
  return found.sort();
}

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
    writeFileSync(join(stage, 'README.md'), '# My App\n');
    mkdirSync(join(stage, 'src'), { recursive: true });
    writeFileSync(join(stage, 'src', 'config.ts'), 'export const APP_SLUG = "my-app";\nexport const DEFAULT_BASE_URL = "https://my-app.apps.queek.com.ng";\n    dbPath: "./data/my-app.db",\n');
    writeFileSync(join(stage, 'README.md'), '# My App\nhttps://my-app.apps.queek.com.ng/install\n');
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

  it('leaves no my-app literal in any scaffolded file for a non-default slug', () => {
    const stage = mkdtempSync(join(tmpdir(), 'starter-'));
    dirs.push(stage);
    // A starter-shaped stage: every file kind that bakes the template slug.
    writeFileSync(join(stage, 'queek.app.toml'), 'slug = "my-app"\nname = "My App"\n\n[app]\ninstall_url = "https://my-app.apps.queek.com.ng/install"\n');
    writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'my-app' }));
    writeFileSync(join(stage, 'README.md'), '# My App\nhttps://my-app.apps.queek.com.ng/install\nqueek app versions list my-app\n');
    writeFileSync(join(stage, 'AGENTS.md'), '# My App — Queek app\n');
    writeFileSync(join(stage, 'CLAUDE.md'), '@AGENTS.md');
    writeFileSync(join(stage, '.env.example'), 'APP_BASE_URL=https://my-app.apps.queek.com.ng\nQUEEK_DB_PATH=./data/my-app.db\n');
    writeFileSync(join(stage, 'Dockerfile'), '# docker build -t my-app .\nENV QUEEK_DB_PATH=/app/data/my-app.db\n');
    writeFileSync(join(stage, 'server.js'), 'console.log(`[my-app] on port ${PORT}`);\n');
    mkdirSync(join(stage, 'app'), { recursive: true });
    writeFileSync(join(stage, 'app', 'config.ts'), 'export const APP_SLUG = "my-app";\nexport const DEFAULT_BASE_URL = "https://my-app.apps.queek.com.ng";\n    dbPath: "./data/my-app.db",\n');
    mkdirSync(join(stage, 'tests'), { recursive: true });
    writeFileSync(join(stage, 'tests', 'helpers.ts'), 'APP_BASE_URL: "https://my-app.apps.queek.com.ng",\n');
    // Binary files are never rewritten (null byte) — and never match text grep.
    writeFileSync(join(stage, 'app', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x6d, 0x79, 0x2d, 0x61, 0x70, 0x70]));
    setupApp(stage, { slug: 'paystack-bridge', name: 'Paystack Bridge' });
    setupAgentFiles(stage);
    expect(templateLeftovers(stage)).toEqual([]);
    // Spot-check the load-bearing renames: the credential slug, the base
    // URL default, fixtures, and the display name.
    expect(readFileSync(join(stage, 'app', 'config.ts'), 'utf8')).toContain('APP_SLUG = "paystack-bridge"');
    expect(readFileSync(join(stage, 'app', 'config.ts'), 'utf8')).toContain('https://paystack-bridge.apps.queek.com.ng');
    expect(readFileSync(join(stage, '.env.example'), 'utf8')).toContain('APP_BASE_URL=https://paystack-bridge.apps.queek.com.ng');
    expect(readFileSync(join(stage, 'server.js'), 'utf8')).toContain('[paystack-bridge]');
    expect(readFileSync(join(stage, 'README.md'), 'utf8')).toContain('# Paystack Bridge');
    expect(readFileSync(join(stage, 'AGENTS.md'), 'utf8')).toContain('# Paystack Bridge');
  });

  it('sweepTemplateIdentity renames nested files and skips binaries', () => {
    const stage = mkdtempSync(join(tmpdir(), 'starter-'));
    dirs.push(stage);
    mkdirSync(join(stage, 'app', 'routes'), { recursive: true });
    writeFileSync(join(stage, 'app', 'routes', 'page.tsx'), 'placeholder="Hello from My App"\n');
    writeFileSync(join(stage, 'font.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32, 0x00, 0x6d, 0x79, 0x2d, 0x61, 0x70, 0x70]));
    sweepTemplateIdentity(stage, 'paystack-bridge', 'Paystack Bridge');
    expect(readFileSync(join(stage, 'app', 'routes', 'page.tsx'), 'utf8')).toContain('Hello from Paystack Bridge');
    expect(templateLeftovers(stage)).toEqual([]);
  });

  it('refuses to scaffold on Node older than 22.14', () => {
    expect(nodeVersionProblem('v22.12.0')).toContain('22.14');
    expect(nodeVersionProblem('v22.12.0')).toContain('nvm');
    expect(nodeVersionProblem('v22.11.0')).not.toBeNull();
    expect(nodeVersionProblem('v20.19.0')).not.toBeNull();
    expect(nodeVersionProblem('v22.14.0')).toBeNull();
    expect(nodeVersionProblem('v22.20.4')).toBeNull();
    expect(nodeVersionProblem('v25.2.0')).toBeNull();
    expect(() => assertNodeVersion('v22.12.0')).toThrow('Node >= 22.14');
    expect(() => assertNodeVersion('v22.14.0')).not.toThrow();
    expect(() => assertNodeVersion(process.version)).not.toThrow();
  });

  it('ships the starter agent files verbatim plus both MCP wirings', () => {
    const stage = mkdtempSync(join(tmpdir(), 'starter-'));
    dirs.push(stage);
    // A starter-shaped stage: the real layout words, the capacity-check
    // pointer, and none of the stale scaffolder claims.
    const agents = [
      '# My App — Queek app',
      'FIRST run the capacity check: install the Queek AI toolkit',
      'npx skills add usequeek/queek-ai-toolkit',
      'and follow its `queek-capacity` skill',
      '- Layout — handlers live in `app/` (there is no `src/`): install/uninstall/settings handoff in `app/queek.server.ts`; embedded admin in `app/routes/admin*`; `queek.app.toml` is the manifest source of truth.',
      '- Dev loop: `queek app dev` over `@usequeek/app-sdk`.',
      'Do not add tooling to this repo.',
      '',
    ].join('\n');
    writeFileSync(join(stage, 'AGENTS.md'), agents);
    writeFileSync(join(stage, 'CLAUDE.md'), '@AGENTS.md');
    setupAgentFiles(stage);
    // Verbatim: the scaffolder never rewrites the starter's bytes.
    expect(readFileSync(join(stage, 'AGENTS.md'), 'utf8')).toBe(agents);
    expect(readFileSync(join(stage, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md');
    for (const mcp of [join(stage, '.mcp.json'), join(stage, '.cursor', 'mcp.json')]) {
      expect(JSON.parse(readFileSync(mcp, 'utf8'))).toEqual({ mcpServers: {} });
    }
  });

  it('scaffolded AGENTS.md carries the capacity check and the real layout, never the stale claims', () => {
    const stage = mkdtempSync(join(tmpdir(), 'starter-'));
    dirs.push(stage);
    const agents = [
      '# My App — Queek app',
      'FIRST run the capacity check: install the Queek AI toolkit',
      'npx skills add usequeek/queek-ai-toolkit',
      'and follow its `queek-capacity` skill',
      '- Layout — handlers live in `app/` (there is no `src/`): install/uninstall/settings handoff in `app/queek.server.ts`; embedded admin in `app/routes/admin*`; `queek.app.toml` is the manifest source of truth.',
      '- Dev loop: `queek app dev` over `@usequeek/app-sdk`.',
      '',
    ].join('\n');
    writeFileSync(join(stage, 'AGENTS.md'), agents);
    writeFileSync(join(stage, 'CLAUDE.md'), '@AGENTS.md');
    setupAgentFiles(stage);
    const shipped = readFileSync(join(stage, 'AGENTS.md'), 'utf8');
    for (const must of ['queek-capacity', 'npx skills add usequeek/queek-ai-toolkit', 'app/routes/admin', 'app/queek.server.ts', 'queek app dev', 'queek.app.toml', '@usequeek/app-sdk']) {
      expect(shipped).toContain(must);
    }
    expect(shipped).not.toContain('not published yet');
    expect(shipped).not.toContain('live in `src/`');
    expect(shipped).not.toContain('handlers live in `src/`');
  });

  it('refuses a stage without the starter agent files instead of inventing them', () => {
    const stage = mkdtempSync(join(tmpdir(), 'starter-'));
    dirs.push(stage);
    expect(() => setupAgentFiles(stage)).toThrow('AGENTS.md');
    writeFileSync(join(stage, 'AGENTS.md'), '# My App\n');
    expect(() => setupAgentFiles(stage)).toThrow('CLAUDE.md');
  });

  it('banners the next steps plus the AI setup (starter AGENTS.md + MCP location)', () => {
    const banner = successBanner('my-app');
    expect(banner).toContain('cd my-app');
    expect(banner).toContain('queek app dev');
    expect(banner).toContain('AGENTS.md');
    expect(banner).toContain('capacity check');
    expect(banner).toContain('Queek MCP');
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
    for (const junk of ['.git', 'node_modules', 'dist', 'build', 'dist-admin', '.react-router', 'data', '.queek']) {
      mkdirSync(join(source, junk), { recursive: true });
      writeFileSync(join(source, junk, 'junk.txt'), 'junk');
    }
    const into = mkdtempSync(join(tmpdir(), 'staged-'));
    dirs.push(into);
    await fetchStarter(into, source, 'unused');
    expect(existsSync(join(into, 'queek.app.toml'))).toBe(true);
    expect(existsSync(join(into, '.env.example'))).toBe(true);
    for (const junk of ['.git', 'node_modules', 'dist', 'build', 'dist-admin', '.react-router', 'data', '.queek', '.env']) {
      expect(existsSync(join(into, junk))).toBe(false);
    }
  });
});
