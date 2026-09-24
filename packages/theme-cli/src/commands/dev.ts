import { Command, Flags } from '@oclif/core';
import { resolveProject } from '../lib/project.js';
import { startPreview, writePreview } from '../lib/preview.js';

export default class Dev extends Command {
  static override summary = 'Preview your theme as a whole store, every page of every demo store.';

  static override description = `Renders the theme with real Next.js against its demo stores — theme/demo.json at /default, each theme/demos/<id>.json at /<id> — with the same composition a live Queek storefront uses. Edits reload the page.

The preview app is written to .queek/preview in your project and regenerated on every run; it ignores itself for git.`;

  static override examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --port 4000', '<%= config.bin %> <%= command.id %> --path ../my-theme'];

  static override flags = {
    path: Flags.string({ summary: 'The theme project (or its theme folder).', default: '.', env: 'QUEEK_THEME_PATH' }),
    port: Flags.integer({ summary: 'Port to serve on.', default: 3000, min: 1, max: 65535, env: 'QUEEK_THEME_PORT' }),
    host: Flags.string({ summary: 'Host to bind. Use 0.0.0.0 to reach it from another device.', default: '127.0.0.1', env: 'QUEEK_THEME_HOST' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Dev);
    let project;
    try {
      project = resolveProject(flags.path);
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }

    this.logToStderr('Starting the preview…');
    const dir = writePreview(project);
    const server = await startPreview(project, dir, flags.host, flags.port).catch((error: Error & { code?: string }) =>
      this.error(error.code === 'EADDRINUSE' ? `Port ${flags.port} is in use. Pass --port with a free one.` : error.message, { exit: 2 }));

    this.log(`\n  Preview: ${server.url}\n  Stores and pages are listed there. Ctrl+C to stop.\n`);

    const stop = async (): Promise<void> => {
      await server.close();
      process.exit(0);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    await new Promise(() => {});
  }
}
