import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { createJiti } from 'jiti';
import { demoFilesOf } from './utils/theme-demos.js';
import type { CheckEnv, DeclaredDemo, DemoStore, ThemeContext, ThemeManifest } from './types.js';

/** The contract every theme is checked against, as published with the starter. */
export const CONTRACT_URL = 'https://github.com/usequeek/theme-starter/blob/main/docs/THEME.md';

/**
 * Page-block scopes. A theme declaring none of them is chrome-only — it renders
 * one page and lets core supply the rest. The page-based structure
 * requirements do not apply to it, derived from what the theme declares.
 */
const PAGE_BLOCK_SCOPES = ['gallery', 'products', 'categories', 'content'];

/** The environment a developer's own repo gets: paths relative to where they run, public links. */
export function localEnv(dir: string, cwd = process.cwd()): CheckEnv {
  const shown = relative(cwd, dir).replace(/\\/g, '/');
  return {
    root: shown === '' ? '' : `${shown.startsWith('..') ? dir.replace(/\\/g, '/') : shown}/`,
    docs: CONTRACT_URL,
    vocabulary: 'the business vocabulary (docs/business-vocabulary.json in the starter)',
    scaffold: '`npm create @usequeek/theme`',
    preview: (templateId) => `http://localhost:3000/${templateId}`,
    submission: false,
  };
}

type ThemeConfig = { slug?: unknown; active?: unknown; description?: unknown; demos?: unknown; default_demo?: { description?: unknown; for?: unknown } };

/**
 * Everything the rules read about one theme folder. Its TypeScript modules
 * (theme.config.ts, manifest.ts) load through jiti, resolving imports from
 * the theme's own project — the kit the developer installed, not ours.
 */
export async function loadContext(themeDir: string, env: Partial<CheckEnv> = {}): Promise<ThemeContext> {
  const dir = resolve(themeDir);
  const file = (path: string): string => join(dir, path);
  const exists = (path: string): boolean => existsSync(file(path));
  const read = (path: string): string | null => (exists(path) ? readFileSync(file(path), 'utf8') : null);
  const jiti = createJiti(file('theme.config.ts'), { moduleCache: false, fsCache: false, interopDefault: true });

  // A file that will not parse is kept, with null data, so the demo-store rule
  // can name it instead of the theme looking like it has one store fewer.
  const demos: DemoStore[] = demoFilesOf(dir).map(({ id, path }) => {
    const shown = relative(dir, path).replace(/\\/g, '/');
    try {
      return { id, file: shown, data: JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> };
    } catch {
      return { id, file: shown, data: null };
    }
  });

  let config: ThemeConfig | null = null;
  try {
    config = await jiti.import<ThemeConfig>(file('theme.config.ts'), { default: true });
  } catch {
    config = null;
  }

  let manifest: ThemeManifest | null = null;
  try {
    manifest = await jiti.import<ThemeManifest>(file('manifest.ts'), { default: true });
  } catch {
    manifest = null;
  }

  const variants = (manifest?.variants ?? {}) as Record<string, unknown[]>;
  const declared = config?.demos;
  const primary = config?.default_demo;

  return {
    env: { ...localEnv(dir), ...env },
    slug: typeof config?.slug === 'string' ? config.slug : basename(dir),
    dir,
    retired: config?.active === false,
    demo: demos.find((store) => store.id === 'default')?.data ?? null,
    demos,
    themeConfig: config,
    declaredDemos: config === null ? null : Array.isArray(declared) ? (declared as DeclaredDemo[]) : [],
    defaultDescription: typeof primary?.description === 'string' ? primary.description : null,
    defaultFor: primary?.for ?? null,
    themeDescription: typeof config?.description === 'string' ? config.description : null,
    manifest,
    pageBased: PAGE_BLOCK_SCOPES.some((scope) => (variants[scope] ?? []).length > 0),
    file,
    exists,
    read,
  };
}

/** Every JS/TS source file under a theme, for the whole-tree scans. */
export function themeSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : themeSourceFiles(full);
    return /\.[mc]?[jt]sx?$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Load a module of the kit the theme's project installed. The kit ships
 * TypeScript source, which Node will not execute from node_modules, so it goes
 * through jiti — resolved from the theme, never bundled with this package.
 */
export async function importKit<T>(themeDir: string, specifier: string): Promise<T> {
  const jiti = createJiti(join(resolve(themeDir), 'theme.config.ts'), { interopDefault: true });
  return jiti.import<T>(specifier);
}
