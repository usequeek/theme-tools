import { Args, Flags } from '@oclif/core';
import { clackPrompter, runCreate } from '@usequeek/create-app';
import { BaseCommand } from '../../lib/base-command.js';

export default class AppInit extends BaseCommand {
  static override summary = 'Start a new app from the public starter (same as `npm create @usequeek/app`).';

  static override description = 'Downloads usequeek/queek-app-starter, renames it to your slug, and writes a queek.app.toml whose `dev`/`check`/`deploy` scripts call back into this CLI.';

  static override examples = [
    '<%= config.bin %> <%= command.id %> my-app',
    '<%= config.bin %> <%= command.id %> my-app --slug my-app --yes',
  ];

  static override args = {
    dir: Args.string({ description: 'Folder to create (default: the slug).' }),
  };

  static override flags = {
    slug: Flags.string({ summary: 'App slug: 2-64 lowercase letters, digits or dashes (default: the folder name).' }),
    name: Flags.string({ summary: 'Display name (default: the slug).' }),
    pm: Flags.string({ summary: 'Package manager: npm, pnpm, yarn or bun.' }),
    install: Flags.boolean({ summary: 'Install dependencies.', default: true, allowNo: true }),
    git: Flags.boolean({ summary: 'Run git init.', default: true, allowNo: true }),
    yes: Flags.boolean({ char: 'y', summary: 'Never prompt; take the default for everything else.', default: false }),
    'dry-run': Flags.boolean({ summary: 'Print what would be written; write nothing.', default: false }),
    force: Flags.boolean({ summary: 'Allow a folder that is not empty.', default: false }),
    template: Flags.string({ summary: 'Another starter: a giget source or a local folder.' }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(AppInit);
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !flags.yes;
    try {
      await runCreate(
        {
          dir: args.dir, slug: flags.slug, name: flags.name, pm: flags.pm, install: flags.install,
          git: flags.git, yes: flags.yes, dryRun: flags['dry-run'], force: flags.force, template: flags.template,
        },
        interactive ? clackPrompter() : null,
        (line) => this.log(line),
      );
    } catch (error) {
      const { message, exitCode } = error as Error & { exitCode?: number };
      this.error(message, { exit: exitCode ?? 1 });
    }
  }
}
