import { loadContext } from './context.js';
import { ANALYSIS_RULES } from './rules/analysis.js';
import { STATIC_RULES } from './rules/static.js';
import type { CheckEnv, Finding, Rule, ThemeContext } from './types.js';

/** Every rule that runs on a developer's machine, in the order they report. */
export const RULES: Rule[] = [...STATIC_RULES, ...ANALYSIS_RULES];

/**
 * Checks that only Queek can run, when a theme is submitted: they need Queek's
 * other themes, a server render, or Queek's storage. Listed so a clean local
 * run never reads as "nothing else can fail".
 */
export const AT_SUBMISSION: ReadonlyArray<{ id: string; summary: string }> = [
  { id: 'theme/divergence', summary: 'the design is its own, not a copy of an existing Queek theme' },
  { id: 'theme/renders', summary: 'every declared variant renders visible content with sample data' },
  { id: 'theme/price-range-signal', summary: 'a product priced as a range shows "From", not its floor as the price' },
  { id: 'theme/demo-art-hosting', summary: 'demo images are moved onto Queek’s CDN (done for you)' },
  { id: 'theme/template-screenshot', summary: 'template screenshots are uploaded (done for you)' },
];

export interface CheckOptions {
  /** Override how findings name files and where they link (see CheckEnv). */
  env?: Partial<CheckEnv>;
  /** Run only these rule ids. */
  only?: string[];
}

export interface CheckResult {
  context: ThemeContext;
  findings: Finding[];
}

/** Every finding for the theme in `themeDir`. No `reject` finding means it will pass these checks on submission. */
export async function checkTheme(themeDir: string, options: CheckOptions = {}): Promise<CheckResult> {
  const context = await loadContext(themeDir, options.env);
  const rules = RULES.filter((rule) => !options.only || options.only.includes(rule.id));

  const findings: Finding[] = [];
  for (const rule of rules) {
    try {
      findings.push(...(await rule.run(context)));
    } catch (error) {
      // A rule that throws is itself a failure signal — a theme whose module
      // graph will not load cannot be published, and silently skipping the
      // rule would report that theme as clean.
      findings.push({
        rule: rule.id,
        severity: 'reject',
        theme: context.slug,
        found: `the check could not run: ${(error as Error).message}`,
        fix: 'Usually a theme module that fails to load. Run `npx tsc --noEmit` and fix the error first.',
      });
    }
  }

  return { context, findings };
}

export const rejects = (findings: Finding[]): Finding[] => findings.filter((finding) => finding.severity === 'reject');
