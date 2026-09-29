import { Args, Flags } from '@oclif/core';
import * as p from '@clack/prompts';
import { applyAddPlan, planAddDesign, type AddPlan } from '@usequeek/create-theme';
import { BaseCommand } from '../../lib/base-command.js';
import { resolveProject, type Project } from '../../lib/project.js';
import { resolveCommandVocabulary, vocabularyFlags } from '../../lib/vocabulary.js';
import { answer, dryRunLines, heading, isInteractive, nextSteps, readTemplates, relativeFiles } from './shared.js';

/** What `theme add design --json` prints. */
export interface AddDesignReport {
  added: Record<string, unknown>;
  files: string[];
}

export default class AddDesign extends BaseCommand {
  static override summary = "Add a design to a template: a second (or third) store of the same business.";

  static override description = `Copies the template's first design to demos/<key>-2.json (then -3) with fresh ids, and declares it \`{ id, template, design_label }\` — the grouping is the explicit template, never the suffix. Refuses a 4th design of one template.

When the first design has no design_label, it is asked for (a template with two or more designs needs one on each): pass --first-label with --yes or without a terminal.`;

  static override examples = [
    '<%= config.bin %> <%= command.id %> food --label "Grill house"',
    '<%= config.bin %> <%= command.id %> food --label "Second look" --first-label "Main" --yes',
  ];

  static override args = {
    template: Args.string({ description: 'Template key to add a design to (required with --yes).' }),
  };

  static override flags = {
    path: Flags.string({ summary: 'The theme project (or its theme folder).', default: '.', env: 'QUEEK_THEME_PATH' }),
    label: Flags.string({ summary: 'What tells this design from its template\'s others ("Grill house").' }),
    'first-label': Flags.string({ summary: 'design_label for the first design, when it has none.' }),
    yes: Flags.boolean({ char: 'y', summary: 'Never prompt; take the default for everything else.', default: false }),
    'dry-run': Flags.boolean({ summary: 'Print what would be written; write nothing.', default: false }),
    ...vocabularyFlags,
  };

  async run(): Promise<AddDesignReport | void> {
    const { args, flags } = await this.parse(AddDesign);
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
    // The vocabulary is resolved for the notice and the debug line, as on
    // every command; designs do not validate against it.
    try {
      const vocabulary = await resolveCommandVocabulary(flags, (line) => this.logToStderr(line));
      this.debug(`vocabulary: ${vocabulary.source} ${vocabulary.data.services.length} services`);
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }

    const templates = await readTemplates(project.themeDir);
    let template = args.template?.trim() ?? '';
    if (!template) {
      if (!interactive) {
        this.error(`template is required with --yes or without a terminal — pass \`queek theme add design <template>\` (templates: ${templates.map((candidate) => candidate.key).join(', ') || 'none yet'}).`, { exit: 2 });
      }
      template = answer<string>(await p.select({
        message: 'Template to add a design to',
        options: templates.map((candidate) => ({
          value: candidate.key as string,
          label: candidate.label,
          hint: `${candidate.designs.length} design${candidate.designs.length === 1 ? '' : 's'}`,
        })),
      }), fail);
    }

    let label = flags.label?.trim() ?? '';
    if (!label) {
      if (!interactive) {
        this.error('--label <design label> is required with --yes or without a terminal: what tells this design from its template\'s others ("Grill house").', { exit: 2 });
      }
      label = answer<string>(await p.text({
        message: `What tells the new ${template} design apart`,
        placeholder: 'Grill house',
        validate: (value) => ((value?.trim() ?? '') === '' ? 'The design needs a label.' : undefined),
      }), fail).trim();
    }

    const chosen = templates.find((candidate) => candidate.key === template);
    const needsFirstLabel = chosen !== undefined && chosen.designs.length > 0 && chosen.designs[0]!.designLabel === null;
    let firstLabel = flags['first-label']?.trim() ?? '';
    if (needsFirstLabel && !firstLabel) {
      if (!interactive) {
        this.error(`Design "${chosen!.designs[0]!.id}" has no design_label, and a template with ${chosen!.designs.length + 1} designs needs one on each. Pass --first-label "<what tells ${chosen!.designs[0]!.id} apart>" to name it.`, { exit: 2 });
      }
      firstLabel = answer<string>(await p.text({
        message: `What tells the first ${template} design ("${chosen!.designs[0]!.id}") apart`,
        placeholder: 'Dining room',
        validate: (value) => ((value?.trim() ?? '') === '' ? 'Every design of a template with two or more needs a label.' : undefined),
      }), fail).trim();
    }

    let plan: AddPlan;
    try {
      plan = await planAddDesign(project.themeDir, { template, label, ...(firstLabel ? { firstLabel } : {}) });
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
