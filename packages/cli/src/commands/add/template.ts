import { Args, Flags } from '@oclif/core';
import * as p from '@clack/prompts';
import { applyAddPlan, planAddTemplate, templateOptions, vocabularyLists, type AddPlan } from '@usequeek/create-theme';
import { BaseCommand } from '../../lib/base-command.js';
import { resolveProject, type Project } from '../../lib/project.js';
import { resolveCommandVocabulary, vocabularyFlags } from '../../lib/vocabulary.js';
import { answer, dryRunLines, heading, isInteractive, nextSteps, relativeFiles } from './shared.js';

/** What `theme add template --json` prints. */
export interface AddTemplateReport {
  added: Record<string, unknown>;
  files: string[];
}

export default class AddTemplate extends BaseCommand {
  static override summary = 'Add a template for a business: a new demo store declared in theme.config.ts.';

  static override description = `Adds a template for a vocabulary business key. Its first design is a new demo store (demos/<business>.json), built from the skeleton the same way \`create\` builds one per template, and declared in theme.config.ts with its template, label and for.

In a terminal, anything not given as a flag is asked — the business from the list, never typed. With --yes or without a terminal, nothing is asked: pass the business, and --label when the display name should differ.`;

  static override examples = [
    '<%= config.bin %> <%= command.id %> jewelry --label "Jewelry"',
    '<%= config.bin %> <%= command.id %> laundry --yes',
  ];

  static override args = {
    business: Args.string({ description: 'Vocabulary business key to make a template for (required with --yes).' }),
  };

  static override flags = {
    path: Flags.string({ summary: 'The theme project (or its theme folder).', default: '.', env: 'QUEEK_THEME_PATH' }),
    label: Flags.string({ summary: 'Display name for the template (default: the business name).' }),
    yes: Flags.boolean({ char: 'y', summary: 'Never prompt; take the default for everything else.', default: false }),
    'dry-run': Flags.boolean({ summary: 'Print what would be written; write nothing.', default: false }),
    ...vocabularyFlags,
  };

  async run(): Promise<AddTemplateReport | void> {
    const { args, flags } = await this.parse(AddTemplate);
    this.setVerbose(flags.verbose as boolean | undefined);
    const json = (flags as { json?: boolean }).json === true;

    let project: Project;
    try {
      project = resolveProject(flags.path);
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }
    this.debug(`project root: ${project.root}`);
    this.debug(`theme dir: ${project.themeDir}`);

    const fail = (message: string, options: { exit: number }): never => this.error(message, options);
    const interactive = isInteractive(flags.yes);

    let lists;
    try {
      const vocabulary = await resolveCommandVocabulary(flags, (line) => this.logToStderr(line));
      lists = vocabularyLists(vocabulary.data);
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }
    this.debug(`vocabulary: ${lists.businessKeys.length} businesses`);

    let business = args.business?.trim() ?? '';
    if (!business) {
      if (!interactive) {
        this.error(`business is required with --yes or without a terminal — pass \`queek theme add template <business>\` (choose from: ${lists.businessKeys.join(', ')}).`, { exit: 2 });
      }
      business = answer<string>(await p.autocomplete({
        message: 'Business to make a template for (type to search)',
        options: templateOptions(lists).map((option) => ({ value: option.value, label: option.label, hint: option.hint })),
      }), fail);
    }
    let label = flags.label;
    if (label === undefined && interactive) {
      label = answer<string>(await p.text({
        message: `Display name for the ${business} template`,
        placeholder: lists.labelOf(business),
        defaultValue: lists.labelOf(business),
        validate: (value) => ((value?.trim() || lists.labelOf(business)).trim() === '' ? 'The template needs a name.' : undefined),
      }), fail).trim() || lists.labelOf(business);
    }

    let plan: AddPlan;
    try {
      plan = await planAddTemplate(project.themeDir, { business, label }, lists);
    } catch (error) {
      this.error((error as Error).message, { exit: (error as { exitCode?: number }).exitCode ?? 1 });
    }
    const files = relativeFiles(plan);

    if (flags['dry-run']) {
      const lines = [...dryRunLines(plan), ...nextSteps(plan).map((step) => `  ${step}`)];
      if (json) for (const line of lines) this.logToStderr(line);
      else for (const line of lines) this.log(line);
      if (json) return { added: plan.added, files };
      return;
    }

    applyAddPlan(plan);
    const lines = [heading(plan), 'Next:', ...nextSteps(plan).map((step) => `  ${step}`)];
    if (json) {
      for (const line of lines) this.logToStderr(line);
      return { added: plan.added, files };
    }
    for (const line of lines) this.log(line);
  }
}
