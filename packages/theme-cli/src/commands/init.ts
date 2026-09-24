import { Args, Command, Flags } from '@oclif/core';
import { createTheme } from '@usequeek/create-theme';

export default class Init extends Command {
  static override summary = 'Start a new theme from the Queek theme starter.';

  static override description = 'The same as `npm create @usequeek/theme`: copies github.com/usequeek/theme-starter into a new folder and installs its dependencies.';

  static override examples = ['<%= config.bin %> <%= command.id %> my-theme', '<%= config.bin %> <%= command.id %> my-theme --no-install'];

  static override args = {
    dir: Args.string({ description: 'Folder to create.', default: 'my-theme' }),
  };

  static override flags = {
    install: Flags.boolean({ summary: 'Install dependencies after copying.', default: true, allowNo: true }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Init);
    try {
      await createTheme({ dir: args.dir, install: flags.install, log: (line) => this.log(line) });
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }
  }
}
