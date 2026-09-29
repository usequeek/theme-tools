import { Args, Flags } from '@oclif/core';
import { applyAddPlan, planAddPage, type AddPlan } from '@usequeek/create-theme';
import { BaseCommand } from '../../lib/base-command.js';
import { resolveProject, type Project } from '../../lib/project.js';
import { resolveCommandVocabulary, vocabularyFlags } from '../../lib/vocabulary.js';
import { dryRunLines, heading, nextSteps, relativeFiles } from './shared.js';

/** What `theme add page --json` prints. */
export interface AddPageReport {
  added: Record<string, unknown>;
  files: string[];
}

export default class AddPage extends BaseCommand {
  static override summary = "Add an optional page (contact, faq) to a design's store.";

  static override description = `Adds the contact or faq page to a design's store — the primary's by default, or --template <key> for a template's first design (a design id names that design). The page comes from the skeleton's, plus its menu item when the store's header menu lacks one. Refuses a page the store already has.`;

  static override examples = [
    '<%= config.bin %> <%= command.id %> contact',
    '<%= config.bin %> <%= command.id %> faq --template food',
  ];

  static override args = {
    page: Args.string({ description: 'Page to add.', options: ['contact', 'faq'], required: true }),
  };

  static override flags = {
    path: Flags.string({ summary: 'The theme project (or its theme folder).', default: '.', env: 'QUEEK_THEME_PATH' }),
    template: Flags.string({ summary: "Template to add the page to (default: the primary template's design). Accepts a template key or a design id." }),
    yes: Flags.boolean({ char: 'y', summary: 'Never prompt; take the default for everything else.', default: false }),
    'dry-run': Flags.boolean({ summary: 'Print what would be written; write nothing.', default: false }),
    ...vocabularyFlags,
  };

  async run(): Promise<AddPageReport | void> {
    const { args, flags } = await this.parse(AddPage);
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

    // The vocabulary is resolved for the notice and the debug line, as on
    // every command; pages do not validate against it.
    try {
      const vocabulary = await resolveCommandVocabulary(flags, (line) => this.logToStderr(line));
      this.debug(`vocabulary: ${vocabulary.source} ${vocabulary.data.services.length} services`);
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }

    let plan: AddPlan;
    try {
      plan = await planAddPage(project.themeDir, { page: args.page as string, template: flags.template });
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
