import { createHash } from 'node:crypto';
import { createWriteStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Flags } from '@oclif/core';
import {
  applyDisableComments,
  applyProjectConfig,
  checkTheme,
  CONFIG_FILE_NAME,
  loadProjectConfig,
  summarize,
  type CheckResult,
} from '@usequeek/theme-check';
import yazl from 'yazl';
import { BaseCommand } from '../lib/base-command.js';
import { resolveProject, type Project } from '../lib/project.js';
import { resolveCommandVocabulary, vocabularyFlags } from '../lib/vocabulary.js';

const SKIP = new Set(['node_modules', '.queek', '.next', '.git', '.DS_Store']);

function filesOf(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name) || entry.name.endsWith('.zip')) return [];
    const full = join(dir, entry.name);
    return entry.isDirectory() ? filesOf(full) : [full];
  });
}

/** What `package --json` prints: the zip and the check counts. */
export interface PackageReport {
  theme: string;
  /** The zip, relative to where the command ran. */
  file: string;
  bytes: number;
  sha256: string;
  errors: number;
  warnings: number;
}

export default class Package extends BaseCommand {
  static override summary = 'Zip your theme for submission.';

  static override description = 'Writes <slug>.zip containing the theme folder (never node_modules, .queek or .git). It runs the check first and tells you if errors would block the submission.';

  static override examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> --output dist/my-theme.zip'];

  static override flags = {
    path: Flags.string({ summary: 'The theme project (or its theme folder).', default: '.', env: 'QUEEK_THEME_PATH' }),
    output: Flags.string({ summary: 'Where to write the zip. Defaults to <slug>.zip in the project.' }),
    ...vocabularyFlags,
  };

  async run(): Promise<PackageReport | void> {
    const { flags } = await this.parse(Package);
    this.setVerbose(flags.verbose as boolean | undefined);

    let project: Project;
    let result: CheckResult;
    try {
      project = resolveProject(flags.path);
      const vocabulary = await resolveCommandVocabulary(flags, (line) => this.logToStderr(line));
      result = await checkTheme(project.themeDir, { vocabulary });
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }
    this.debug(`project root: ${project.root}`);
    this.debug(`theme dir: ${project.themeDir}`);
    this.debug(`vocabulary: ${result.vocabulary.source} ${result.vocabulary.version}`);

    try {
      const config = loadProjectConfig(project.root);
      if (config) {
        result = { ...result, findings: applyProjectConfig(result.findings, config) };
        this.debug(`config: ${config.path} (${Object.keys(config.rules).length} rules, ${config.ignore.length} ignore patterns)`);
      } else {
        this.debug(`config: no ${CONFIG_FILE_NAME}`);
      }
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }

    result = { ...result, findings: applyDisableComments(result.findings, project.themeDir) };

    const out = resolve(flags.output ?? join(project.root, `${result.context.slug}.zip`));
    const files = filesOf(project.themeDir);
    const zip = new yazl.ZipFile();
    for (const file of files) zip.addFile(file, `theme/${relative(project.themeDir, file).replace(/\\/g, '/')}`);
    zip.end();
    await new Promise<void>((done, fail) => {
      zip.outputStream.pipe(createWriteStream(out)).on('close', done).on('error', fail);
    });
    this.debug(`zip entries: ${files.length}`);

    const report: PackageReport = {
      theme: result.context.slug,
      file: relative(process.cwd(), out) || out,
      bytes: statSync(out).size,
      sha256: createHash('sha256').update(readFileSync(out)).digest('hex'),
      ...summarize(result.findings),
    };

    if ((flags as { json?: boolean }).json) return report;

    this.log(`Packaged ${result.context.slug} → ${report.file}`);
    if (report.errors > 0) this.warn(`${report.errors} error(s) will block this submission — run \`${this.config.bin} check\` to see them.`);
  }
}
