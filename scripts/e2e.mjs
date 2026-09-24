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

  cpSync(join(ROOT, 'fixtures/starter/theme'), join(project, 'theme'), { recursive: true });
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'my-theme', private: true, type: 'module' }, null, 2));
  sh(npm, ['install', '--no-audit', '--no-fund', '@usequeek/theme-kit@^0.1.8', '@queekai/client-sdk@^0.3.1', 'next@^16', 'react@^19', 'react-dom@^19', 'typescript@^5', ...tarballs], project);
  console.log('e2e: installed from the tarballs');

  const check = sh(process.execPath, [join(project, 'node_modules/@usequeek/theme-cli/bin/run.js'), 'check', '--format', 'json'], project, true);
  const report = JSON.parse(check.stdout);
  if (check.status !== 0 || report.summary.errors !== 0) throw new Error(`check: exit ${check.status}, ${report.summary.errors} error(s)`);
  console.log(`e2e: check ✓ (${report.summary.warnings} warnings)`);

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
    for (const path of ['/', '/default', '/default/about', '/default/sales', '/default/landing', '/default/shop', '/default/products/placeholder-one', '/default/collections', '/default/blog']) {
      const response = await fetch(`http://127.0.0.1:${PORT}${path}`);
      const body = await response.text();
      if (response.status !== 200 || /Application error|Unhandled Runtime Error/.test(body)) throw new Error(`dev: ${path} → ${response.status}\n${log.slice(-2000)}`);
    }
    if ((await fetch(`http://127.0.0.1:${PORT}/no-such-store`)).status !== 404) throw new Error('dev: an unknown store should 404');
    console.log('e2e: dev ✓ (9 pages render, unknown store 404s)');
  } finally {
    dev.kill('SIGTERM');
  }
  console.log('e2e: all passed');
} finally {
  rmSync(work, { recursive: true, force: true });
}
