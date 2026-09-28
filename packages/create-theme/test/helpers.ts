import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const FIXTURE_THEME = resolve(import.meta.dirname, '../../../fixtures/starter/theme');

/** A starter checkout as create downloads it: the skeleton theme, package.json, docs and the AI files. */
export function starterProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'create-theme-test-'));
  cpSync(FIXTURE_THEME, join(dir, 'theme'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify({ name: 'queek-starter', private: true }, null, 2)}\n`);
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) writeFileSync(join(dir, file), file === 'AGENTS.md' ? '# Building a Queek theme\n' : '@AGENTS.md\n');
  mkdirSync(join(dir, '.claude/skills/queek'), { recursive: true });
  writeFileSync(join(dir, '.claude/skills/queek/SKILL.md'), '---\nname: queek\n---\n');
  mkdirSync(join(dir, 'docs'));
  writeFileSync(join(dir, 'docs/THEME.md'), '# Contract\n');
  return dir;
}
