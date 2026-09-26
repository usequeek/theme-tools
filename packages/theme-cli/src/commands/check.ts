import { Command, Flags } from '@oclif/core';
import { checkTheme, formatGithubActions, formatJson, formatStylish, levelOf, summarize } from '@usequeek/theme-check';
import { resolveProject } from '../lib/project.js';
import { resolveCommandVocabulary, vocabularyFlags } from '../lib/vocabulary.js';

export default class Check extends Command {
  static override summary = 'Check your theme against the Queek theme contract.';

  static override description = `Runs the same rules Queek runs when you submit, except the few that need Queek's side (they are listed at the end of the report). Errors block submission; warnings are advice.

Exit codes: 0 — no errors (or no findings at --fail-level warning); 1 — findings at or above the fail level; 2 — the check could not run.`;

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> --format json > report.json',
    '<%= config.bin %> <%= command.id %> --format github-actions   # annotations on a pull request',
  ];

  static override flags = {
    path: Flags.string({ summary: 'The theme project (or its theme folder).', default: '.', env: 'QUEEK_THEME_PATH' }),
    format: Flags.string({ summary: 'Output format.', options: ['stylish', 'json', 'github-actions'], default: 'stylish', env: 'QUEEK_THEME_FORMAT' }),
    'fail-level': Flags.string({ summary: 'Lowest level that makes the command exit 1.', options: ['error', 'warning'], default: 'error' }),
    quiet: Flags.boolean({ summary: 'Report errors only.', default: false }),
    ...vocabularyFlags,
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Check);
    let result;
    try {
      const project = resolveProject(flags.path);
      const vocabulary = await resolveCommandVocabulary(flags, (line) => this.logToStderr(line));
      result = await checkTheme(project.themeDir, { vocabulary });
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }

    if (flags.quiet) result = { ...result, findings: result.findings.filter((finding) => levelOf(finding) === 'error') };

    const color = process.stdout.isTTY === true && !process.env.NO_COLOR && process.env.TERM !== 'dumb';
    const output = flags.format === 'json' ? formatJson(result) : flags.format === 'github-actions' ? formatGithubActions(result) : formatStylish(result, { color });
    if (output) this.log(output);

    const { errors, warnings } = summarize(result.findings);
    if (errors > 0 || (flags['fail-level'] === 'warning' && warnings > 0)) this.exit(1);
  }
}
