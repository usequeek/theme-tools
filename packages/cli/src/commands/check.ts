import { existsSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Flags } from '@oclif/core';
import {
  applyProjectConfig,
  checkTheme,
  CONFIG_FILE_NAME,
  formatGithubActions,
  formatJson,
  formatStylish,
  jsonReport,
  levelOf,
  loadProjectConfig,
  renderInitConfig,
  summarize,
  type CheckResult,
} from '@usequeek/theme-check';
import { BaseCommand } from '../lib/base-command.js';
import { resolveProject, type Project } from '../lib/project.js';
import { resolveCommandVocabulary, vocabularyFlags } from '../lib/vocabulary.js';

export default class Check extends BaseCommand {
  static override summary = 'Check your theme against the Queek theme contract.';

  static override description = `Runs the same rules Queek runs when you submit, except the few that need Queek's side (they are listed at the end of the report). Errors block submission; warnings are advice.

Exit codes: 0 — no errors (or no findings at --fail-level warning); 1 — findings at or above the fail level; 2 — the check could not run.

With --init, writes a starter ${CONFIG_FILE_NAME} in the project instead of checking.`;

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --format json > report.json',
    '<%= config.bin %> <%= command.id %> --format github-actions   # annotations on a pull request',
    '<%= config.bin %> <%= command.id %> --init   # starter .queek-theme.yml',
  ];

  static override flags = {
    path: Flags.string({ summary: 'The theme project (or its theme folder).', default: '.', env: 'QUEEK_THEME_PATH' }),
    format: Flags.string({ summary: 'Output format.', options: ['stylish', 'json', 'github-actions'], default: 'stylish', env: 'QUEEK_THEME_FORMAT' }),
    'fail-level': Flags.string({ summary: 'Lowest level that makes the command exit 1.', options: ['error', 'warning'], default: 'error' }),
    quiet: Flags.boolean({ summary: 'Report errors only.', default: false }),
    init: Flags.boolean({ summary: `Write a starter ${CONFIG_FILE_NAME} in the project and exit.`, default: false }),
    ...vocabularyFlags,
  };

  async run(): Promise<Record<string, unknown> | void> {
    const { flags } = await this.parse(Check);
    this.setVerbose(flags.verbose as boolean | undefined);

    let project: Project;
    try {
      project = resolveProject(flags.path);
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }
    this.debug(`project root: ${project.root}`);
    this.debug(`theme dir: ${project.themeDir}`);

    if (flags.init) {
      const target = join(project.root, CONFIG_FILE_NAME);
      if (existsSync(target)) {
        this.error(`${CONFIG_FILE_NAME} already exists at ${target}; leaving it unchanged.`, { exit: 2 });
      }
      writeFileSync(target, renderInitConfig());
      if ((flags as { json?: boolean }).json) return { file: relative(process.cwd(), target) };
      this.log(`Wrote ${target}`);
      return;
    }

    const timings: Array<[string, number]> = [];
    let result: CheckResult;
    try {
      const vocabulary = await resolveCommandVocabulary(flags, (line) => this.logToStderr(line));
      result = await checkTheme(project.themeDir, { vocabulary, profile: (rule, ms) => timings.push([rule, ms]) });
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }

    this.debug(`vocabulary: ${result.vocabulary.source} ${result.vocabulary.version}`);

    try {
      const config = loadProjectConfig(project.root);
      if (config) {
        result = { ...result, findings: applyProjectConfig(result.findings, config) };
        const rules = Object.keys(config.rules).length;
        process.stderr.write(`Using ${CONFIG_FILE_NAME} (${rules} rule${rules === 1 ? '' : 's'} changed, ${config.ignore.length} ignore pattern${config.ignore.length === 1 ? '' : 's'}).\n`);
        this.debug(`config: ${config.path} (${rules} rules, ${config.ignore.length} ignore patterns)`);
      } else {
        this.debug(`config: no ${CONFIG_FILE_NAME}`);
      }
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }

    if (flags.quiet) result = { ...result, findings: result.findings.filter((finding) => levelOf(finding) === 'error') };

    for (const [rule, ms] of timings) this.debug(`rule ${rule}: ${ms}ms`);

    const { errors, warnings } = summarize(result.findings);
    const failed = errors > 0 || (flags['fail-level'] === 'warning' && warnings > 0);

    if ((flags as { json?: boolean }).json) {
      // `this.exit(1)` throws before oclif prints the return value, so set
      // the code directly and return the report for `--json` to print.
      if (failed) process.exitCode = 1;
      return jsonReport(result) as unknown as Record<string, unknown>;
    }

    const color = process.stdout.isTTY === true && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
    const output = flags.format === 'json' ? formatJson(result) : flags.format === 'github-actions' ? formatGithubActions(result) : formatStylish(result, { color });
    if (output) this.log(output);

    if (failed) this.exit(1);
  }
}
