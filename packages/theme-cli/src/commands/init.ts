import { Args, Command, Flags } from '@oclif/core';
import { clackPrompter, runCreate } from '@usequeek/create-theme';

export default class Init extends Command {
  static override summary = 'Start a new theme, the same as `npm create @usequeek/theme`.';

  static override description = 'Asks for anything not given as a flag (in a terminal), then writes a renamed skeleton whose `check` output is your to-do list.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> my-theme',
    '<%= config.bin %> <%= command.id %> my-theme --templates laundry,foods --primary laundry --tags minimal --yes',
  ];

  static override args = { dir: Args.string({ description: 'Folder to create (default: named after the theme when asked in a terminal, otherwise my-theme).' }) };

  static override flags = {
    name: Flags.string({ summary: 'Theme name (default: the folder name).' }),
    templates: Flags.string({ summary: 'Businesses to make templates for, comma-separated.' }),
    primary: Flags.string({ summary: 'The primary template (default: the first).' }),
    categories: Flags.string({ summary: "Business categories (default: the templates')." }),
    tags: Flags.string({ summary: '1–6 tags for the look.' }),
    pages: Flags.string({ summary: 'Extra pages: contact, faq, or none.' }),
    ai: Flags.string({ summary: 'AI assistants: claude, gemini.' }),
    'no-ai': Flags.boolean({ summary: 'Write no AI instructions.', default: false }),
    pm: Flags.string({ summary: 'Package manager: npm, pnpm, yarn or bun.' }),
    install: Flags.boolean({ summary: 'Install dependencies.', default: true, allowNo: true }),
    git: Flags.boolean({ summary: 'Run git init.', default: true, allowNo: true }),
    yes: Flags.boolean({ char: 'y', summary: 'Accept every default; never prompt.', default: false }),
    'dry-run': Flags.boolean({ summary: 'Print what would be written; write nothing.', default: false }),
    force: Flags.boolean({ summary: 'Allow a folder that is not empty.', default: false }),
    template: Flags.string({ summary: 'Another starter: a giget source or a local folder.' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Init);
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !flags.yes;
    try {
      await runCreate({
        dir: args.dir, name: flags.name, templates: flags.templates, primary: flags.primary, categories: flags.categories,
        tags: flags.tags, pages: flags.pages, ai: flags.ai, noAi: flags['no-ai'], pm: flags.pm, install: flags.install,
        git: flags.git, yes: flags.yes, dryRun: flags['dry-run'], force: flags.force, template: flags.template,
      }, interactive ? clackPrompter() : null, (line) => this.log(line));
    } catch (error) {
      const { message, exitCode } = error as Error & { exitCode?: number };
      this.error(message, { exit: exitCode ?? 1 });
    }
  }
}
