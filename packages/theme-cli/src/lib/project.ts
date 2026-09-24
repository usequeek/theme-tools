import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface Project {
  /** The folder holding package.json — where `next`, `react` and the kit are installed. */
  root: string;
  /** The theme: the folder with manifest.ts, index.ts and demo.json. */
  themeDir: string;
}

const isTheme = (dir: string): boolean => existsSync(join(dir, 'manifest.ts'));

/**
 * `--path` may name the project (the starter layout: `<project>/theme/`) or the
 * theme folder itself. Either way the project is the nearest package.json at or
 * above the theme.
 */
export function resolveProject(path: string): Project {
  const start = resolve(path);
  if (!existsSync(start)) throw new Error(`${path} does not exist.`);
  const themeDir = isTheme(start) ? start : isTheme(join(start, 'theme')) ? join(start, 'theme') : null;
  if (!themeDir) {
    throw new Error(`No theme found at ${path}: expected a manifest.ts there or in ${join(path, 'theme')}. Run this in a theme project (npm create @usequeek/theme), or pass --path.`);
  }
  let root = themeDir;
  while (!existsSync(join(root, 'package.json'))) {
    if (dirname(root) === root) throw new Error(`No package.json above ${themeDir}. A theme lives in a project that installs @usequeek/theme-kit, next and react.`);
    root = dirname(root);
  }
  return { root, themeDir };
}
