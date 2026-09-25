// End to end, the way a theme developer gets the tools: the three packages are
// packed exactly as npm would publish them, installed from those tarballs into
// a fresh project OUTSIDE this repo next to the fixture theme, and the CLI is
// run there. Nothing here borrows the monorepo's node_modules — that is the
// point (in-repo green says nothing about what a consumer installs).
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = 3217;
const work = mkdtempSync(join(tmpdir(), 'queek-theme-e2e-'));
const project = join(work, 'my-theme');
const packs = join(work, 'packs');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function sh(cmd, args, cwd, allowFail = false) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, NO_COLOR: '1', QUEEK_THEME_SKIP_NEW_VERSION_CHECK: 'true' } });
  if (result.status !== 0 && !allowFail) throw new Error(`${cmd} ${args.join(' ')} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  return result;
}

try {
  mkdirSync(packs);
  for (const pkg of ['theme-check', 'create-theme', 'theme-cli']) sh('pnpm', ['pack', '--pack-destination', packs], join(ROOT, 'packages', pkg));
  const tarballs = readdirSync(packs).map((file) => join(packs, file));
  console.log(`e2e: packed ${tarballs.length} packages`);

  // The journey a developer takes: create, then install, then check.
  const tools = join(work, 'tools');
  mkdirSync(tools);
  writeFileSync(join(tools, 'package.json'), JSON.stringify({ name: 'tools', private: true, type: 'module' }));
  sh(npm, ['install', '--no-audit', '--no-fund', ...tarballs], tools);
  const starter = join(work, 'starter');
  cpSync(join(ROOT, 'fixtures/starter'), starter, { recursive: true });
  writeFileSync(join(starter, 'package.json'), JSON.stringify({ name: 'queek-theme-starter', private: true, type: 'module' }, null, 2));
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) writeFileSync(join(starter, file), file === 'AGENTS.md' ? '# Queek theme\n' : '@AGENTS.md\n');
  sh(process.execPath, [join(tools, 'node_modules/@usequeek/create-theme/dist/cli.js'), project, '--yes', '--template', starter, '--name', 'My Theme', '--templates', 'laundry,foods', '--primary', 'laundry', '--tags', 'minimal', '--pages', 'contact', '--ai', 'claude', '--no-install', '--no-git'], work);
  console.log('e2e: create ✓');

  sh(npm, ['install', '--no-audit', '--no-fund', '@usequeek/theme-kit@^0.1.8', '@queekai/client-sdk@^0.3.1', 'next@^16', 'react@^19', 'react-dom@^19', 'typescript@^5', ...tarballs], project);
  console.log('e2e: installed from the tarballs');

  // A freshly created theme is not clean — it still carries the starter's
  // placeholder products/photos/descriptions, two designs with the same
  // home layout (create clones one demo per template), and no screenshots
  // (create deletes the skeleton's own theme.jpg: it would misrepresent
  // whatever the developer ends up designing). What create declares is
  // complete, so theme/template-designs is never on the list: every design
  // names its template (contract R2.8). `formatJson` in
  // packages/theme-check/src/format.ts emits findings[].rule and
  // findings[].level, 'error' for a reject.
  const check = sh(process.execPath, [join(project, 'node_modules/@usequeek/theme-cli/bin/run.js'), 'check', '--format', 'json'], project, true);
  const report = JSON.parse(check.stdout);
  const rejects = [...new Set(report.findings.filter((f) => f.level === 'error').map((f) => f.rule))].sort();
  const todo = ['theme/placeholder-content', 'theme/structure', 'theme/template-description', 'theme/template-screenshot', 'theme/template-versions'];
  if (JSON.stringify(rejects) !== JSON.stringify(todo)) throw new Error(`check after create: expected exactly the to-do list ${todo.join(', ')}, got ${rejects.join(', ')}`);
  console.log(`e2e: check ✓ (exactly the to-do list: ${todo.join(', ')})`);

  sh(process.execPath, [join(project, 'node_modules/@usequeek/theme-cli/bin/run.js'), 'package'], project);
  console.log('e2e: package ✓');

  const dev = spawn(process.execPath, [join(project, 'node_modules/@usequeek/theme-cli/bin/run.js'), 'dev', '--port', String(PORT)], { cwd: project, stdio: 'pipe', env: { ...process.env, QUEEK_THEME_SKIP_NEW_VERSION_CHECK: 'true' } });
  let log = '';
  dev.stdout.on('data', (chunk) => { log += chunk; });
  dev.stderr.on('data', (chunk) => { log += chunk; });
  try {
    const deadline = Date.now() + 180_000;
    for (;;) {
      try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break; } catch { /* not up yet */ }
      if (Date.now() > deadline) throw new Error(`dev did not start:\n${log}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    for (const path of ['/', '/default', '/foods', '/default/about', '/default/sales', '/default/landing', '/default/contact', '/default/shop', '/default/products/placeholder-one']) {
      const response = await fetch(`http://127.0.0.1:${PORT}${path}`);
      const body = await response.text();
      if (response.status !== 200 || /Application error|Unhandled Runtime Error/.test(body)) throw new Error(`dev: ${path} → ${response.status}\n${log.slice(-2000)}`);
    }
    if ((await fetch(`http://127.0.0.1:${PORT}/no-such-store`)).status !== 404) throw new Error('dev: an unknown store should 404');
    // The index groups designs by the template each declares (R2.8), through
    // the resolver the CLI copies into the preview.
    const index = await (await fetch(`http://127.0.0.1:${PORT}/`)).text();
    for (const key of ['laundry', 'foods']) if (!index.includes(`· template ${key}`)) throw new Error(`dev: the index does not list the ${key} template\n${index.slice(0, 2000)}`);
    console.log('e2e: dev ✓ (9 pages render, unknown store 404s, the index lists both templates)');
  } finally {
    dev.kill('SIGTERM');
  }
  console.log('e2e: all passed');
} finally {
  rmSync(work, { recursive: true, force: true });
}
