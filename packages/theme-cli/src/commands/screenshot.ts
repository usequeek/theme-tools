import { Args, Flags } from '@oclif/core';
import { BaseCommand } from '../lib/base-command.js';
import { demoFilesOf, screenshotFile } from '@usequeek/theme-check';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { launchBrowser } from '../lib/browser.js';
import { pickPort } from '../lib/port.js';
import { startPreview, writePreview } from '../lib/preview.js';
import { resolveProject, type Project } from '../lib/project.js';

/** How long the preview may take to start before the command gives up. */
const BOOT_TIMEOUT_MS = 5 * 60_000;

/** One design's screenshot: the design id and the file it is written to, relative to the project root. */
export interface ScreenshotTarget {
  design: string;
  file: string;
}

/**
 * Every design to capture, with the file the checker reads for it: the
 * primary design `default` → `theme.jpg` (or `theme.png` when only a png
 * exists), design `<id>` → `demos/<id>.jpg` (`screenshotFile`, the same
 * naming the checker judges by). Files are relative to the project root.
 * Throws (code `UNKNOWN_DESIGN`) for an id with no demo store.
 */
export function screenshotTargets(project: Project, only: string[]): ScreenshotTarget[] {
  const designs = demoFilesOf(project.themeDir).map((demo) => demo.id);
  const unknown = only.filter((id) => !designs.includes(id));
  if (unknown.length > 0) {
    throw Object.assign(
      new Error(`Unknown design${unknown.length === 1 ? '' : 's'} ${unknown.map((id) => `"${id}"`).join(', ')}. Designs: ${designs.join(', ')}.`),
      { code: 'UNKNOWN_DESIGN' },
    );
  }
  const ids = only.length > 0 ? only : designs;
  if (ids.length === 0) {
    throw Object.assign(new Error('No demo stores found: expected theme/demo.json or theme/demos/*.json.'), { code: 'UNKNOWN_DESIGN' });
  }
  const exists = (path: string): boolean => existsSync(join(project.themeDir, path));
  return ids.map((design) => ({
    design,
    file: relative(project.root, join(project.themeDir, screenshotFile(design, exists))).replace(/\\/g, '/'),
  }));
}

/**
 * Run `run` with stdout muted. Next prints its boot line ("✓ Running
 * next.config…") straight to stdout, outside oclif's `--json` suppression —
 * muting the boot keeps `--json` one parseable object. Errors still go to
 * stderr, and our own command prints nothing to stdout while booting.
 */
async function muteStdout<T>(run: () => Promise<T>): Promise<T> {
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try {
    return await run();
  } finally {
    process.stdout.write = write;
  }
}

export default class Screenshot extends BaseCommand {
  static override summary = 'Capture every design\'s first screen at 1280×800 into the files the checker reads.';

  static override description = `Starts the same preview \`dev\` serves, opens every design (its demo store) at 1280×800, and writes the screenshot the checker reads: theme/theme.jpg for the primary design, theme/demos/<id>.jpg for the rest. Pass design ids to capture only those.

Needs a Chromium-based browser: Google Chrome, Microsoft Edge, Playwright's own chromium (\`npx playwright install chromium\`), or QUEEK_THEME_BROWSER pointing at an executable.`;

  static override examples = ['<%= config.bin %> <%= command.id %>', '<%= config.bin %> <%= command.id %> food', '<%= config.bin %> <%= command.id %> --port 7840'];

  static override args = {
    designs: Args.string({ description: 'Designs to capture (default: every design).', multiple: true }),
  };

  static override flags = {
    path: Flags.string({ summary: 'The theme project (or its theme folder).', default: '.', env: 'QUEEK_THEME_PATH' }),
    port: Flags.integer({ summary: 'Port to serve the preview on [default: 7833, or the next free port].', min: 1, max: 65535, env: 'QUEEK_THEME_PORT' }),
  };


  async run(): Promise<{ files: Array<{ design: string; file: string; bytes: number }> }> {
    const { args, flags } = await this.parse(Screenshot);
    this.setVerbose(flags.verbose);
    let project: Project;
    try {
      project = resolveProject(flags.path);
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }

    let targets: ScreenshotTarget[];
    try {
      targets = screenshotTargets(project, args.designs ?? []);
    } catch (error) {
      this.error((error as Error).message, { exit: 2 });
    }

    const port = await pickPort({ host: '127.0.0.1', requested: flags.port })
      .catch((error: Error) => this.error(error.message, { exit: 2 }));
    this.debug(`project root: ${project.root}`);
    this.debug(`port: ${port}${flags.port === undefined ? ' (first free from 7833)' : ''}`);
    const dir = writePreview(project);
    this.debug(`preview app: ${dir}`);
    // A preview that never starts must not hang a script or CI job.
    const boot = (): Promise<{ url: string; close: () => Promise<void> }> =>
      Promise.race([
        startPreview(project, dir, '127.0.0.1', port, { quiet: flags.json === true }),
        new Promise<never>((_, fail) => setTimeout(() => fail(new Error(`The preview did not start within ${BOOT_TIMEOUT_MS / 60_000} minutes. Run \`npx queek-theme dev\` to see why.`)), BOOT_TIMEOUT_MS).unref()),
      ]);
    const server = await (flags.json === true ? muteStdout(boot) : boot()).catch((error: Error & { code?: string }) =>
      this.error(error.code === 'EADDRINUSE' ? `Port ${port} is in use. Pass another --port, or leave --port out to use the next free one.` : error.message, { exit: 2 }));

    let browser;
    try {
      browser = await launchBrowser();
    } catch (error) {
      await server.close();
      this.error((error as Error).message, { exit: 2 });
    }

    const files: Array<{ design: string; file: string; bytes: number }> = [];
    try {
      for (const target of targets) {
        const url = `http://127.0.0.1:${port}/${target.design}`;
        this.debug(`capturing ${url}`);
        const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        try {
          const page = await context.newPage();
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
          // Every image on the first screen decoded, or the screenshot shows grey boxes.
          await page
            .waitForFunction(
              'viewportHeight => [...document.images].filter((image) => image.getBoundingClientRect().top < viewportHeight).every((image) => image.complete && image.naturalWidth > 0)',
              800,
              { timeout: 60_000 },
            )
            .catch(() => this.warn(`${url}: some first-screen images were still loading`));
          await page.addStyleTag({ content: 'nextjs-portal, [data-nextjs-toast] { display: none !important; }' });
          await page.waitForTimeout(1500); // entrance motion settles

          const absolute = join(project.root, target.file);
          mkdirSync(dirname(absolute), { recursive: true });
          const png = target.file.toLowerCase().endsWith('.png');
          await page.screenshot({ path: absolute, type: png ? 'png' : 'jpeg', ...(png ? {} : { quality: 86 }) });
          const bytes = statSync(absolute).size;
          files.push({ design: target.design, file: target.file, bytes });
          // Suppressed under --json by the framework; the JSON carries the files instead.
          this.log(`${target.design} → ${target.file} (${Math.max(1, Math.round(bytes / 1024))} KB)`);
        } catch (error) {
          this.error(`Could not capture "${target.design}" (${url}): ${(error as Error).message}`, { exit: 2 });
        } finally {
          await context.close();
        }
      }
    } finally {
      await browser.close();
      await server.close();
    }

    if (flags.json) this.logJson({ files });
    else this.log('Next: npx queek-theme check');
    // Next's dev watchers keep the event loop alive after close() (dev exits
    // explicitly for the same reason), so a finished run would never
    // terminate on its own. Exit here: the JSON above is printed exactly
    // once, because run() never returns to the framework's --json printer.
    // The declared return documents the --json shape.
    process.exit(0);
  }
}
