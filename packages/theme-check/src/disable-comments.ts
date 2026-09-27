import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { themeSourceFiles } from './context.js';
import { ANALYSIS_RULES } from './rules/analysis.js';
import { STATIC_RULES } from './rules/static.js';
import type { Finding } from './types.js';
import { closestRuleId, cssDisableDirectives, tsDisableDirectives, type DisableDirective } from './utils/disable-comments.js';

/**
 * Inline disable comments, applied by the CLI `check`/`package` commands
 * (never by `checkTheme` itself):
 *
 *   // queek-theme-disable-next-line theme/a, theme/b   (.ts/.tsx)
 *   A block comment with queek-theme-disable-next-line theme/a inside (.css)
 *
 * A comment drops the **warn** findings of the named rules whose `where` is
 * that file at the next line. Reject findings stay. A comment naming an
 * unknown rule id adds a `theme/disable-comment` warning instead.
 */

/** Every known rule id — the same set `RULES` in run.js is built from, without importing it (importing run.js here would cycle back through the static rules). */
const knownRuleIds = (): Set<string> => new Set([...STATIC_RULES, ...ANALYSIS_RULES].map((rule) => rule.id));

function cssFilesOf(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : cssFilesOf(full);
    return entry.name.endsWith('.css') ? [full] : [];
  });
}

export interface UnknownDisableId {
  file: string;
  line: number;
  id: string;
}

/** Every `queek-theme-disable-next-line` naming an unknown rule id, in every source file. */
export function scanUnknownDisableIds(themeDir: string, known: Set<string> = knownRuleIds()): UnknownDisableId[] {
  const dir = resolve(themeDir);
  const found: UnknownDisableId[] = [];
  for (const file of themeSourceFiles(dir)) {
    for (const directive of tsDisableDirectives(readFileSync(file, 'utf8'))) {
      for (const id of directive.rules) {
        if (!known.has(id)) found.push({ file, line: directive.line, id });
      }
    }
  }
  for (const file of cssFilesOf(dir)) {
    for (const directive of cssDisableDirectives(readFileSync(file, 'utf8'))) {
      for (const id of directive.rules) {
        if (!known.has(id)) found.push({ file, line: directive.line, id });
      }
    }
  }
  return found;
}

/** `where` without its ` → detail` tail (`theme/demo.json → pages.home` → `theme/demo.json`). */
function filePartOf(where: string): string {
  return where.split(' → ')[0]?.trim() ?? '';
}

/** The `:line` of a `where`, if it names one. */
function linePartOf(where: string): number | null {
  const match = /:(\d+)$/.exec(filePartOf(where));
  return match ? Number(match[1]) : null;
}

/** The theme file a finding names, resolved to disk (its `where` may carry the env root prefix). */
function resolveFindingFile(dir: string, filePart: string): string | null {
  const bare = filePart.replace(/:\d+$/, '');
  const parts = bare.replace(/\\/g, '/').split('/').filter((part) => part !== '');
  for (let drop = 0; drop < parts.length; drop++) {
    const candidate = join(dir, ...parts.slice(drop));
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * Drop the warn findings a disable comment covers, and add a
 * `theme/disable-comment` warning for every unknown rule id. Only the files
 * with warn findings are read for suppression; unknown ids are scanned for
 * in every source file.
 */
export function applyDisableComments(findings: Finding[], themeDir: string): Finding[] {
  const dir = resolve(themeDir);
  const known = knownRuleIds();

  const directives = new Map<string, DisableDirective[]>();
  for (const finding of findings) {
    if (finding.severity !== 'warn' || !finding.where) continue;
    const file = resolveFindingFile(dir, filePartOf(finding.where));
    if (!file || directives.has(file)) continue;
    const source = readFileSync(file, 'utf8');
    directives.set(file, file.endsWith('.css') ? cssDisableDirectives(source) : tsDisableDirectives(source));
  }

  const suppressed = (finding: Finding): boolean => {
    if (finding.severity !== 'warn' || !finding.where) return false;
    const line = linePartOf(finding.where);
    if (line === null) return false;
    const file = resolveFindingFile(dir, filePartOf(finding.where));
    if (!file) return false;
    return (directives.get(file) ?? []).some((directive) => directive.line + 1 === line && directive.rules.includes(finding.rule));
  };
  const kept = findings.filter((finding) => !suppressed(finding));

  const seen = new Set(kept.map((finding) => `${finding.rule}\n${finding.where}\n${finding.found}`));
  for (const unknown of scanUnknownDisableIds(dir, known)) {
    const where = `${relative(process.cwd(), unknown.file).replace(/\\/g, '/')}:${unknown.line}`;
    const found = `unknown rule "${unknown.id}" in a disable comment`;
    const key = `theme/disable-comment\n${where}\n${found}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hint = closestRuleId(unknown.id, known);
    kept.push({
      rule: 'theme/disable-comment',
      severity: 'warn',
      theme: basename(dir),
      where,
      found,
      fix: hint ? `Did you mean "${hint}"? Update the comment to name a real rule id.` : 'Update the comment to name a real rule id.',
    });
  }
  return kept;
}
