import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { nameProblem, slugProblem, slugify } from './naming.js';
import { UsageError, type Flags, type PackageManager, type Prompter } from './options.js';
import { assertNodeVersion, createApp, defaultSlug } from './setup.js';

export { UsageError, CancelledError, type Flags, type Prompter, type PackageManager } from './options.js';
export { setupApp, type Answers } from './setup.js';
export { clackPrompter } from './prompts.js';
export { slugify, slugProblem, nameProblem, MAX_DISPLAY_NAME_LENGTH } from './naming.js';

/** The starter this release was tested with: the public template repo. */
export const STARTER = 'github:usequeek/queek-app-starter';

export function detectPackageManager(userAgent = process.env.npm_config_user_agent ?? ''): PackageManager {
  const name = userAgent.split('/')[0];
  return name === 'pnpm' || name === 'yarn' || name === 'bun' ? name : 'npm';
}

export const HELP = `Create a Queek installable app.

  npm create @usequeek/app@latest my-app
  pnpm create @usequeek/app my-app

npm needs -- before these flags. In a terminal, anything you leave out is asked,
and with no folder the folder is named after the slug (my-app with --yes or no terminal).

  --slug <slug>          2-64 lowercase letters, digits or hyphens (default: the folder name)
  --name <text>          display name, 1-80 chars, single line (default: the slug)
  --pm <npm|pnpm|yarn|bun>, --no-install, --no-git
  --yes, -y              never prompt; take the default for everything else
  --dry-run              print what would be written; write nothing
  --force                allow a folder that is not empty
  --template <source>    another starter: a giget source or a local folder`;

export async function runCreate(flags: Flags, prompter: Prompter | null, log?: (line: string) => void): Promise<string> {
  // Fail before anything is asked or written: the scaffolded app's tests
  // need node:sqlite (stable since Node 22.14).
  assertNodeVersion();
  const dir = flags.dir ?? 'my-app';
  // Before anything is asked or written: a file is never a target, and a
  // busy folder needs --force.
  if (existsSync(resolve(dir))) {
    if (!statSync(resolve(dir)).isDirectory()) throw new UsageError(`${dir} is a file, not a folder. Choose another name.`);
    if (!flags.force) {
      const { readdirSync } = await import('node:fs');
      if (readdirSync(resolve(dir)).filter((entry) => entry !== '.git').length > 0) {
        throw new UsageError(`${dir} is not empty. Choose another folder, or pass --force to write into it.`);
      }
    }
  }
  const pm = (flags.pm as PackageManager | undefined) ?? detectPackageManager();
  if (!['npm', 'pnpm', 'yarn', 'bun'].includes(pm)) throw new UsageError(`--pm must be npm, pnpm, yarn or bun, not "${flags.pm}".`);

  let slug = flags.slug ?? (flags.yes || prompter === null ? defaultSlug(dir) : slugify(flags.name ?? defaultSlug(dir)));
  let name = (flags.name ?? slug).trim() || slug;
  if (prompter !== null && !flags.yes) {
    slug = await prompter.slug(slug || defaultSlug(dir), (value) => slugProblem(value) ?? undefined);
    name = await prompter.name(name, (value) => nameProblem(value) ?? undefined);
  }
  const slugIssue = slugProblem(slug);
  if (slugIssue) throw new UsageError(`${slugIssue} (pass --slug).`);
  const nameIssue = nameProblem(name);
  if (nameIssue) throw new UsageError(`${nameIssue} (pass --name).`);

  const target = flags.dir ?? slug;
  await createApp(target, { slug, name }, {
    install: flags.install, git: flags.git, pm, dryRun: flags.dryRun, force: flags.force, template: flags.template, log,
  });
  return resolve(target);
}
