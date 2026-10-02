import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseToml } from 'smol-toml';
import { assertNodeVersion, fetchStarter, nameForFile, nodeVersionProblem, setupAgentFiles, setupApp, successBanner, sweepTemplateIdentity, tomlString } from '../src/setup.js';
import { runCreate } from '../src/index.js';
import { MAX_DISPLAY_NAME_LENGTH, nameProblem, slugProblem, slugify } from '../src/naming.js';
import { UsageError } from '../src/options.js';

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

  it('validates display names in one place: empty, long, control chars, markup', () => {
    expect(nameProblem('Paystack Bridge')).toBeNull();
    expect(nameProblem('  Paystack Bridge  ')).toBeNull();
    expect(nameProblem('')).not.toBeNull();
    expect(nameProblem('   ')).not.toBeNull();
    expect(nameProblem('x'.repeat(MAX_DISPLAY_NAME_LENGTH))).toBeNull();
    expect(nameProblem('x'.repeat(MAX_DISPLAY_NAME_LENGTH + 1))).toContain('80');
    expect(nameProblem('Pay $& Go')).toBeNull();
    expect(nameProblem('Evil "name')).toBeNull();
    expect(nameProblem('back\\slash')).toBeNull();
    expect(nameProblem('café 🎉')).toBeNull();
    for (const bad of ['Evil\nname', 'Evil\rname', 'tab\tname', 'nul\0here', 'del\x7fhere', '{markup}']) {
      expect(nameProblem(bad)).not.toBeNull();
    }
  });

  it('quotes TOML strings without injection', () => {
    expect(tomlString('Paystack Bridge')).toBe('"Paystack Bridge"');
    expect(tomlString('Evil "name')).toBe('"Evil \\"name"');
    expect(tomlString('back\\slash')).toBe('"back\\\\slash"');
    expect(tomlString('Pay $& $\' $1')).toBe('"Pay $& $\' $1"');
    // A quoted hostile name is itself valid TOML (proven end to end below).
    expect(parseToml(`name = ${tomlString('Evil "name')}`)).toEqual({ name: 'Evil "name' });
  });

  it('escapes the name per destination file', () => {
    const nasty = 'A"B\\C';
    expect(nameForFile('app/x.toml', nasty)).toBe('A\\"B\\\\C');
    expect(nameForFile('app/x.json', nasty)).toBe('A\\"B\\\\C');
    expect(nameForFile('app/x.ts', nasty)).toBe('A\\"B\\\\C');
    expect(nameForFile('app/x.tsx', 'A"B&C<D>')).toBe('A&quot;B&amp;C&lt;D&gt;');
    expect(nameForFile('README.md', nasty)).toBe(nasty);
  });

  it('scaffolds a hostile display name without resurrection or injection', () => {
    const stage = mkdtempSync(join(tmpdir(), 'starter-'));
    dirs.push(stage);
    // `Pay $& Go` is the MUST-1 resurrection case: `$&` reinserts the match.
    const nasty = 'Pay $& $\' $1 "Go" \\ café 🎉';
    expect(nameProblem(nasty)).toBeNull();
    writeFileSync(join(stage, 'queek.app.toml'), 'slug = "my-app"\nname = "My App"\n');
    writeFileSync(join(stage, 'package.json'), JSON.stringify({ name: 'my-app' }));
    writeFileSync(join(stage, 'README.md'), '# My App\n');
    writeFileSync(join(stage, 'CLAUDE.md'), '@AGENTS.md');
    writeFileSync(join(stage, 'AGENTS.md'), '# My App — Queek app\n');
    writeFileSync(join(stage, 'server.js'), 'console.log(`[my-app]`);\n');
    mkdirSync(join(stage, 'app', 'routes'), { recursive: true });
    writeFileSync(join(stage, 'app', 'bridge.client.ts'), 'throw new Error("Open My App from your Queek dashboard.");\n');
    writeFileSync(join(stage, 'app', 'routes', 'admin.tsx'), '<span className="t">My App</span>\n');
    writeFileSync(join(stage, 'app', 'routes', 'admin.settings.tsx'), 'placeholder="Hello from My App"\n');
    mkdirSync(join(stage, 'tests'), { recursive: true });
    writeFileSync(join(stage, 'tests', 'helpers.ts'), 'APP_BASE_URL: "https://my-app.apps.queek.com.ng",\n');
    setupApp(stage, { slug: 'paystack-bridge', name: nasty });
    setupAgentFiles(stage);
    expect(templateLeftovers(stage)).toEqual([]);
    // The scaffolded manifest parses with the exact hostile name and slug.
    const doc = parseToml(readFileSync(join(stage, 'queek.app.toml'), 'utf8')) as { slug: string; name: string };
    expect(doc.slug).toBe('paystack-bridge');
    expect(doc.name).toBe(nasty);
    // Per-destination escaping: JS strings stay JS, TSX markup stays markup.
    expect(readFileSync(join(stage, 'app', 'bridge.client.ts'), 'utf8')).toContain('Open Pay $& $\' $1 \\"Go\\" \\\\ café 🎉 from');
    expect(readFileSync(join(stage, 'app', 'routes', 'admin.settings.tsx'), 'utf8')).toContain('Hello from Pay $&amp; $\' $1 &quot;Go&quot; \\ café 🎉');
    expect(readFileSync(join(stage, 'app', 'routes', 'admin.tsx'), 'utf8')).toContain('>Pay $&amp; $\' $1 &quot;Go&quot; \\ café 🎉<');
    expect(readFileSync(join(stage, 'README.md'), 'utf8')).toContain(`# ${nasty}`);
    expect(readFileSync(join(stage, 'server.js'), 'utf8')).toContain('[paystack-bridge]');
  });

  it('rejects newline and over-long names at the sweep boundary', () => {
    const stage = mkdtempSync(join(tmpdir(), 'starter-'));
    dirs.push(stage);
    writeFileSync(join(stage, 'queek.app.toml'), 'slug = "my-app"\nname = "My App"\n');
    expect(() => setupApp(stage, { slug: 'bookings', name: 'Evil\nname = "x"' })).toThrow(UsageError);
    expect(() => setupApp(stage, { slug: 'bookings', name: 'x'.repeat(MAX_DISPLAY_NAME_LENGTH + 1) })).toThrow(UsageError);
    expect(() => setupApp(stage, { slug: 'bookings', name: '{x}' })).toThrow(UsageError);
    // Untouched by the failed attempts: the template identity is intact.
    expect(readFileSync(join(stage, 'queek.app.toml'), 'utf8')).toContain('slug = "my-app"');
  });

  it('never leaves two slug lines when the starter has slug and handle', () => {
    const stage = mkdtempSync(join(tmpdir(), 'starter-'));
    dirs.push(stage);
    writeFileSync(join(stage, 'queek.app.toml'), 'slug = "my-app"\nhandle = "legacy"\nname = "My App"\n');
    setupApp(stage, { slug: 'paystack-bridge', name: 'Paystack Bridge' });
    const toml = readFileSync(join(stage, 'queek.app.toml'), 'utf8');
    expect(toml.match(/^slug = /gm)).toHaveLength(1);
    expect(toml).not.toContain('handle');
    expect(toml).toContain('slug = "paystack-bridge"');
  });

  it('keeps a handle-only starter working (legacy key becomes slug)', () => {
    const stage = mkdtempSync(join(tmpdir(), 'starter-'));
    dirs.push(stage);
    writeFileSync(join(stage, 'queek.app.toml'), 'handle = "legacy"\nname = "My App"\n');
    setupApp(stage, { slug: 'paystack-bridge', name: 'Paystack Bridge' });
    const toml = readFileSync(join(stage, 'queek.app.toml'), 'utf8');
    expect(toml.match(/^slug = /gm)).toHaveLength(1);
    expect(toml).toContain('slug = "paystack-bridge"');
  });

  it('runCreate rejects a bad slug with exit 2 and creates nothing', async () => {
    const dir = join(tmpdir(), `bad-slug-${Date.now()}`);
    try {
      await runCreate(
        { dir, slug: 'Bad!', name: 'Bad', install: false, git: false, yes: true, dryRun: false, force: false },
        null,
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UsageError);
      expect((error as UsageError).exitCode).toBe(2);
    }
    expect(existsSync(dir)).toBe(false);
  });

  it('runCreate rejects a bad display name with exit 2 and creates nothing', async () => {
    const dir = join(tmpdir(), `bad-name-${Date.now()}`);
    try {
      await runCreate(
        { dir, slug: 'fine-slug', name: 'Evil\nname', install: false, git: false, yes: true, dryRun: false, force: false },
        null,
      );
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(UsageError);
      expect((error as UsageError).exitCode).toBe(2);
    }
    expect(existsSync(dir)).toBe(false);
  });

  it('runCreate preflights Node before writing anything', async () => {
    const real = Object.getOwnPropertyDescriptor(process, 'version');
    Object.defineProperty(process, 'version', { value: 'v22.12.0', configurable: true });
    try {
      const dir = join(tmpdir(), `old-node-${Date.now()}`);
      await expect(runCreate(
        { dir, slug: 'fine-slug', name: 'Fine', install: false, git: false, yes: true, dryRun: false, force: false },
        null,
      )).rejects.toThrow('Node >= 22.14');
      expect(existsSync(dir)).toBe(false);
    } finally {
      if (real) Object.defineProperty(process, 'version', real);
    }
  });
});
