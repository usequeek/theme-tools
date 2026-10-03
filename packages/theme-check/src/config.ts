import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import picomatch from 'picomatch';
import YAML from 'yaml';
import { RULES } from './run.js';
import type { Finding } from './types.js';
import { closestRuleId } from './utils/closest-id.js';

/**
 * The project config: what a theme's own repo may tune. It changes warnings
 * only — errors are the contract Queek checks on submission, so nothing turns
 * them off. `checkTheme()` never reads it (the submission check must never
 * see a developer's config); the CLI `check`/`package` commands load and
 * apply it.
 */

/** The file at the project root (beside package.json). */
export const CONFIG_FILE_NAME = '.queek-theme.yml';

/** What a rule entry may say: `warning` is the default, a no-op. */
export type ConfigRuleLevel = 'off' | 'warning' | 'error';

export interface ProjectConfig {
  /** The project root the file was read from (globs are relative to it). */
  root: string;
  /** The config file itself. */
  path: string;
  /** Only `off` and `error` entries are kept — `warning` changes nothing. */
  rules: Partial<Record<string, Exclude<ConfigRuleLevel, 'warning'>>>;
  /** Warning findings in these files are not reported. */
  ignore: string[];
}

/** Thrown when the config file exists but is invalid — the CLI exits 2. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const KNOWN_TOP_LEVEL = ['rules', 'ignore'] as const;

/**
 * Read the project config, or null when there is no file. Throws ConfigError
 * (naming the file and the key) when it is invalid.
 */
export function loadProjectConfig(root: string): ProjectConfig | null {
  const path = join(root, CONFIG_FILE_NAME);
  if (!existsSync(path)) return null;

  let data: unknown;
  try {
    data = YAML.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(`Invalid ${CONFIG_FILE_NAME}: the YAML won't parse (${(error as Error).message}).`);
  }
  if (data === null || data === undefined) return { root, path, rules: {}, ignore: [] };
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new ConfigError(`Invalid ${CONFIG_FILE_NAME}: the file must be a mapping with "rules" and/or "ignore".`);
  }

  const record = data as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(KNOWN_TOP_LEVEL as readonly string[]).includes(key)) {
      throw new ConfigError(`Invalid ${CONFIG_FILE_NAME}: unknown top-level key "${key}" (expected "rules" and/or "ignore").`);
    }
  }

  const rules: ProjectConfig['rules'] = {};
  const rawRules = record.rules ?? {};
  if (rawRules === null) {
    // An empty `rules:` (as `check --init` writes) means no overrides.
  } else if (typeof rawRules !== 'object' || Array.isArray(rawRules)) {
    throw new ConfigError(`Invalid ${CONFIG_FILE_NAME}: "rules" must be a mapping of rule id to off, warning or error.`);
  } else {
    const known = new Set(RULES.map((rule) => rule.id));
    for (const [id, value] of Object.entries(rawRules as Record<string, unknown>)) {
      if (!known.has(id)) {
        const hint = closestRuleId(id, known);
        throw new ConfigError(`Invalid ${CONFIG_FILE_NAME}: unknown rule "${id}" in "rules"${hint ? ` (did you mean "${hint}"?)` : ''}.`);
      }
      if (value !== 'off' && value !== 'warning' && value !== 'error') {
        throw new ConfigError(`Invalid ${CONFIG_FILE_NAME}: "rules"."${id}" must be off, warning or error (got ${JSON.stringify(value) ?? String(value)}).`);
      }
      if (value !== 'warning') rules[id] = value;
    }
  }

  const rawIgnore = record.ignore ?? [];
  let ignore: string[] = [];
  if (rawIgnore === null) {
    // An empty `ignore:` (as `check --init` writes) means no patterns.
  } else if (!Array.isArray(rawIgnore) || rawIgnore.some((entry) => typeof entry !== 'string')) {
    throw new ConfigError(`Invalid ${CONFIG_FILE_NAME}: "ignore" must be an array of strings (glob patterns relative to the project root).`);
  } else {
    ignore = [...rawIgnore];
  }

  return { root, path, rules, ignore };
}

/**
 * Apply the config to findings: `off` drops a rule's warn findings, `error`
 * turns them into rejects, and `ignore` globs (relative to the project root,
 * matched against the file part of `where`) drop warn findings in those
 * files. A rule's reject findings are never changed.
 */
export function applyProjectConfig(findings: Finding[], config: ProjectConfig, cwd: string = process.cwd()): Finding[] {
  const matchers = config.ignore.map((pattern) => picomatch(pattern, { dot: true }));
  // A finding's file starts with env.root, which is relative to where `check`
  // ran — so it only matches project-root-relative globs after resolving it
  // against that directory and making it relative to the project root again.
  const ignored = (where: string): boolean => {
    const file = where.split(' → ')[0]?.trim().replace(/:\d+$/, '') ?? '';
    if (!file) return false;
    const rel = relative(config.root, isAbsolute(file) ? file : resolve(cwd, file)).replace(/\\/g, '/');
    return matchers.some((matches) => matches(rel));
  };
  return findings.flatMap((finding) => {
    if (finding.severity !== 'warn') return [finding];
    const override = config.rules[finding.rule];
    if (override === 'off') return [];
    if (override === 'error') return [{ ...finding, severity: 'reject' as const }];
    if (finding.where && matchers.length > 0 && ignored(finding.where)) return [];
    return [finding];
  });
}

/**
 * Rule ids that can emit a warning — the only ones a config (or
 * `check --init`) may name — in RULES order.
 */
export function warningRuleIds(): string[] {
  const warnable = new Set([
    'theme/demo-completeness',
    'theme/template-business',
    'theme/template-pages',
    'theme/locale-key-naming',
    'theme/locale-file-parity',
  ]);
  return RULES.map((rule) => rule.id).filter((id) => warnable.has(id));
}

/** The policy, verbatim: also the first comment of what `check --init` writes. */
export const CONFIG_POLICY =
  "The config changes warnings only. Errors are the contract Queek checks when you submit, so nothing turns them off. If an error is wrong for your theme, open an issue: https://github.com/usequeek/theme-tools/issues";

/** What `check --init` writes: the policy, every warnable rule id commented out, and a sample ignore. */
export function renderInitConfig(): string {
  return [
    `# ${CONFIG_POLICY}`,
    'rules:',
    ...warningRuleIds().map((id) => `  #  ${id}: off`),
    'ignore:',
    '  #  - theme/vendor/**',
    '',
  ].join('\n');
}
