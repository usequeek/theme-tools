import { createWriteStream, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Command, Flags } from '@oclif/core';
import { checkTheme, summarize } from '@usequeek/theme-check';
import yazl from 'yazl';
import { resolveProject } from '../lib/project.js';

const SKIP = new Set(['node_modules', '.queek', '.next', '.git', '.DS_Store']);

function filesOf(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name) || entry.name.endsWith('.zip')) return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? filesOf(full) : [full];
  });
}

export default class Package extends Command {
  static override summary = 'Zip your theme for submission.';

  static override description = 'Writes <slug>.zip containing the theme folder (never node_modules, .queek or .git). It runs the check first and tells you if errors would block the submission.';

  static override examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --output dist/my-theme.zip'];

  static override flags = {
    path: Flags.string({ summary: 'The theme project (or its theme folder).', default: '.', env: 'QUEEK_THEME_PATH' }),
    output: Flags.string({ summary: 'Where to write the zip. Defaults to <slug>.zip in the project.' }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(Package);
    let project;
    let result;
    try {
      project = resolveProject(flags.path);
      result = await checkTheme(project.themeDir);
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }

    const out = resolve(flags.output ?? join(project.root, `${result.context.slug}.zip`));
    const zip = new yazl.ZipFile();
    for (const file of filesOf(project.themeDir)) zip.addFile(file, `theme/${relative(project.themeDir, file).replace(/\\/g, '/')}`);
    zip.end();
    await new Promise<void>((done, fail) => {
      zip.outputStream.pipe(createWriteStream(out)).on('close', done).on('error', fail);
    });

    this.log(`Packaged ${result.context.slug} → ${relative(process.cwd(), out) || out}`);
    const { errors } = summarize(result.findings);
    if (errors > 0) this.warn(`${errors} error(s) will block this submission — run \`${this.config.bin} check\` to see them.`);
  }
}
