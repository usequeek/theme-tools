import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { downloadTemplate } from 'giget';

/** The official starter: theme files only, the tools come from npm. */
export const STARTER = 'github:usequeek/theme-starter';

export interface CreateThemeOptions {
  /** Folder to create. Must be empty or missing. */
  dir: string;
  /** Run the package manager's install afterwards. */
  install?: boolean;
  /** Where progress goes; stdout by default. */
  log?: (line: string) => void;
  /** giget source — overridable for tests and forks. */
  template?: string;
}

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** The package manager that ran us (`npm create`, `pnpm create`…), from the user agent it sets. */
export function detectPackageManager(userAgent = process.env.npm_config_user_agent ?? ''): PackageManager {
  const name = userAgent.split('/')[0];
  return name === 'pnpm' || name === 'yarn' || name === 'bun' ? name : 'npm';
}

/** Copy the starter into `dir`, name the package after the folder, and install. */
export async function createTheme(options: CreateThemeOptions): Promise<void> {
  const log = options.log ?? ((line: string) => console.log(line));
  const dir = resolve(options.dir);
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new Error(`${options.dir} already exists and is not empty. Choose a new folder.`);
  }

  log(`Creating a Queek theme in ${relative(process.cwd(), dir) || '.'}…`);
  await downloadTemplate(options.template ?? STARTER, { dir, force: true });

  const manifest = join(dir, 'package.json');
  if (existsSync(manifest)) {
    const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>;
    pkg.name = basename(dir).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    writeFileSync(manifest, `${JSON.stringify(pkg, null, 2)}\n`);
  }

  const pm = detectPackageManager();
  if (options.install !== false) {
    log(`Installing dependencies with ${pm}…`);
    const result = spawnSync(pm, ['install'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) throw new Error(`${pm} install failed. Run it yourself in ${options.dir}.`);
  }

  const run = pm === 'npm' ? 'npm run' : pm;
  log('');
  log('Done. Next:');
  log(`  cd ${relative(process.cwd(), dir) || '.'}`);
  if (options.install === false) log(`  ${pm} install`);
  log(`  ${run} dev       # preview every page at http://localhost:3000`);
  log(`  ${run} check     # check it against the Queek theme contract`);
  log('');
  log('Build the theme in theme/. The contract is docs/THEME.md.');
}
