import type { CheckResult } from './run.js';
import { AT_SUBMISSION } from './run.js';
import type { Finding } from './types.js';

/** Severity as developers' tools spell it (ESLint, SARIF, GitHub). */
export type Level = 'error' | 'warning';

export const levelOf = (finding: Finding): Level => (finding.severity === 'reject' ? 'error' : 'warning');

/** The file part of a finding's location: `theme/demo.json → pages.home` → `theme/demo.json`. */
export function fileOf(finding: Finding): string | undefined {
  const where = finding.where?.split(' → ')[0]?.trim();
  return where ? where.replace(/:\d+$/, '') : undefined;
}

export interface Summary {
  errors: number;
  warnings: number;
}

export function summarize(findings: Finding[]): Summary {
  return {
    errors: findings.filter((finding) => levelOf(finding) === 'error').length,
    warnings: findings.filter((finding) => levelOf(finding) === 'warning').length,
  };
}

/** Machine-readable output: stable keys, one object per run. */
export function formatJson(result: CheckResult): string {
  return JSON.stringify({
    theme: result.context.slug,
    summary: summarize(result.findings),
    vocabulary: result.vocabulary,
    findings: result.findings.map((finding) => ({
      rule: finding.rule,
      level: levelOf(finding),
      file: fileOf(finding) ?? null,
      where: finding.where ?? null,
      message: finding.found,
      fix: finding.fix,
      docs: finding.docs ?? null,
      fixable: finding.fixable ?? false,
    })),
    atSubmission: AT_SUBMISSION,
  }, null, 2);
}

/** GitHub Actions workflow commands — annotations on the pull request's diff. */
export function formatGithubActions(result: CheckResult): string {
  // https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands
  const data = (text: string): string => text.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  const property = (text: string): string => data(text).replace(/:/g, '%3A').replace(/,/g, '%2C');
  return result.findings.map((finding) => {
    const file = fileOf(finding);
    const props = [file ? `file=${property(file)}` : null, `title=${property(finding.rule)}`].filter(Boolean).join(',');
    return `::${levelOf(finding)} ${props}::${data(`${finding.found} — ${finding.fix}${finding.docs ? ` (${finding.docs})` : ''}`)}`;
  }).join('\n');
}

const paint = (on: boolean) => (code: number, text: string): string => (on ? `\u001B[${code}m${text}\u001B[0m` : text);

/** The default, for people: findings grouped by file, each with its fix and docs. */
export function formatStylish(result: CheckResult, options: { color: boolean }): string {
  const c = paint(options.color);
  const byFile = new Map<string, Finding[]>();
  for (const finding of result.findings) {
    const key = fileOf(finding) ?? result.context.env.root ?? '.';
    byFile.set(key, [...(byFile.get(key) ?? []), finding]);
  }

  const lines: string[] = [];
  for (const [file, findings] of byFile) {
    lines.push('', c(4, file));
    for (const finding of findings) {
      const level = levelOf(finding);
      const detail = finding.where && finding.where.includes(' → ') ? ` ${c(2, finding.where.split(' → ').slice(1).join(' → '))}` : '';
      lines.push(`  ${level === 'error' ? c(31, 'error  ') : c(33, 'warning')}  ${finding.found}${detail}  ${c(2, finding.rule)}`);
      lines.push(`           ${c(2, 'Fix:')} ${finding.fix}`);
      if (finding.docs) lines.push(`           ${c(2, 'Docs:')} ${finding.docs}`);
    }
  }

  const { errors, warnings } = summarize(result.findings);
  lines.push('');
  if (errors + warnings === 0) {
    lines.push(c(32, `✔ ${result.context.slug}: no problems.`));
  } else {
    const parts = [`${errors} error${errors === 1 ? '' : 's'}`, `${warnings} warning${warnings === 1 ? '' : 's'}`];
    lines.push(c(errors > 0 ? 31 : 33, `${errors > 0 ? '✖' : '!'} ${result.context.slug}: ${parts.join(', ')}.`) + (errors > 0 ? ' Errors block submission.' : ''));
  }
  lines.push(c(2, `Also checked when you submit: ${AT_SUBMISSION.map((check) => check.summary).join('; ')}.`));
  return lines.join('\n');
}
