// End to end, the way a theme developer gets the tools: the three packages are
// packed exactly as npm would publish them, installed from those tarballs into
// a fresh project OUTSIDE this repo next to the fixture theme, and the CLI is
// run there. Nothing here borrows the monorepo's node_modules — that is the
// point (in-repo green says nothing about what a consumer installs).
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const PORT = 3217;
const work = mkdtempSync(join(tmpdir(), 'queek-e2e-'));
const project = join(work, 'my-theme');
const packs = join(work, 'packs');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/** A JPEG's dimensions from its SOF0 marker (the frame header), no image library. */
function jpegSize(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('screenshot: theme/theme.jpg is not a JPEG');
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) throw new Error('screenshot: theme/theme.jpg is not a JPEG');
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (marker === 0xc0) return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8] };
    i += 2 + length;
  }
  throw new Error('screenshot: theme/theme.jpg has no SOF0 marker');
}

function sh(cmd, args, cwd, allowFail = false) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32', env: { ...process.env, NO_COLOR: '1', QUEEK_SKIP_NEW_VERSION_CHECK: 'true' } });
  if (result.status !== 0 && !allowFail) throw new Error(`${cmd} ${args.join(' ')} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  return result;
}

// The CLI bin, as installed from the tarballs into the throwaway project.
const queek = () => join(project, 'node_modules/@usequeek/cli/bin/run.js');

try {
  mkdirSync(packs);
  for (const pkg of ['theme-check', 'create-theme', 'cli']) sh('pnpm', ['pack', '--pack-destination', packs], join(ROOT, 'packages', pkg));
  const tarballs = readdirSync(packs).map((file) => join(packs, file));
  console.log(`e2e: packed ${tarballs.length} packages`);

  // The journey a developer takes: create, then install, then check.
  const tools = join(work, 'tools');
  mkdirSync(tools);
  writeFileSync(join(tools, 'package.json'), JSON.stringify({ name: 'tools', private: true, type: 'module' }));
  sh(npm, ['install', '--no-audit', '--no-fund', ...tarballs], tools);
  const starter = join(work, 'starter');
  cpSync(join(ROOT, 'fixtures/starter'), starter, { recursive: true });
  writeFileSync(join(starter, 'package.json'), JSON.stringify({ name: 'queek-starter', private: true, type: 'module' }, null, 2));
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
  const help = sh(process.execPath, [queek(), '--help'], project);
  if (!help.stdout.includes('theme')) throw new Error(`queek --help does not list the theme topic:\n${help.stdout}`);
  const themeHelp = sh(process.execPath, [queek(), 'theme', '--help'], project);
  for (const command of ['check', 'dev', 'init', 'package', 'screenshot']) {
    if (!themeHelp.stdout.includes(command)) throw new Error(`queek theme --help does not list ${command}:\n${themeHelp.stdout}`);
  }
  console.log('e2e: help ✓ (queek --help lists the theme topic, queek theme --help lists the five commands)');

  const check = sh(process.execPath, [queek(), 'theme', 'check', '--format', 'json'], project, true);
  const report = JSON.parse(check.stdout);
  const rejects = [...new Set(report.findings.filter((f) => f.level === 'error').map((f) => f.rule))].sort();
  const todo = ['theme/placeholder-content', 'theme/structure', 'theme/template-description', 'theme/template-screenshot', 'theme/template-versions'];
  if (JSON.stringify(rejects) !== JSON.stringify(todo)) throw new Error(`check after create: expected exactly the to-do list ${todo.join(', ')}, got ${rejects.join(', ')}`);
  console.log(`e2e: check ✓ (exactly the to-do list: ${todo.join(', ')})`);

  sh(process.execPath, [queek(), 'theme', 'package'], project);
  console.log('e2e: package ✓');

  const dev = spawn(process.execPath, [queek(), 'theme', 'dev', '--port', String(PORT)], { cwd: project, stdio: 'pipe', env: { ...process.env, QUEEK_SKIP_NEW_VERSION_CHECK: 'true' } });
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

  // Screenshot, against the same installed project: capture every design and
  // assert theme/theme.jpg exists with a JPEG header that says 1280×800
  // (the SOF0 marker, parsed by hand — no image library). Unconditional on
  // purpose: under CI with no browser this must fail, not skip (GitHub's
  // ubuntu runner has Chrome, reached through playwright-core's `chrome`
  // channel).
  sh(process.execPath, [queek(), 'theme', 'screenshot'], project);
  const shot = readFileSync(join(project, 'theme', 'theme.jpg'));
  const size = jpegSize(shot);
  if (size.width !== 1280 || size.height !== 800) throw new Error(`screenshot: theme/theme.jpg is ${size.width}×${size.height}, expected 1280×800`);
  console.log(`e2e: screenshot ✓ (theme/theme.jpg, JPEG ${size.width}×${size.height}, ${shot.length} bytes)`);

  // The screenshots are the files the checker reads: both screenshot rules
  // leave the to-do list, and nothing else changes.
  const after = JSON.parse(sh(process.execPath, [queek(), 'theme', 'check', '--json'], project, true).stdout);
  const left = [...new Set(after.findings.filter((f) => f.level === 'error').map((f) => f.rule))].sort();
  const expected = todo.filter((rule) => rule !== 'theme/structure' && rule !== 'theme/template-screenshot');
  if (JSON.stringify(left) !== JSON.stringify(expected)) throw new Error(`check after screenshot: expected ${expected.join(', ')}, got ${left.join(', ')}`);
  console.log(`e2e: check after screenshot ✓ (left: ${expected.join(', ')})`);
  console.log('e2e: all passed');
} finally {
  rmSync(work, { recursive: true, force: true });
}
