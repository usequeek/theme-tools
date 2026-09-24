/**
 * A theme's demo stores.
 *
 * `demo.json` is the primary — what the thumbnail, the section-library capture
 * and the registry's top-level compositions come from. `demos/<id>.json` are
 * alternatives (the same store shape, different business): roast previewed as
 * a restaurant instead of a coffee house. Each is declared in `theme.config.ts`
 * (`demos: [{ id, label, for }]`) so the registry can publish it and the
 * backend can offer a food vendor the food demo.
 *
 * The preview URL carries the demo in the theme segment — `roast~foods` —
 * because that is the one place every route, link and the proxy already
 * agree on. `~` is URL-unreserved and cannot appear in a slug, so the split
 * is unambiguous. Four consumers must never disagree about this: the preview
 * routes, theme-check, the registry generator and the rehost command. They
 * all read from here.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const DEMO_SEPARATOR = '~';
/** The id `demo.json` goes by. Reserved — never a file under `demos/`. */
export const PRIMARY_DEMO_ID = 'default';
/** Same shape as a theme slug: it lands in a URL and a filename. */
export const DEMO_ID_FORMAT = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export interface PreviewTheme {
  slug: string;
  demoId: string;
}

/**
 * `roast` → the primary; `roast~foods` → the `foods` store. Null for anything
 * else, including `roast~default` — one canonical URL per store.
 */
export function parsePreviewTheme(param: string): PreviewTheme | null {
  const parts = param.split(DEMO_SEPARATOR);
  if (parts.length > 2) return null;
  const [slug, demoId = PRIMARY_DEMO_ID] = parts;
  if (!DEMO_ID_FORMAT.test(slug) || !DEMO_ID_FORMAT.test(demoId)) return null;
  if (parts.length === 2 && demoId === PRIMARY_DEMO_ID) return null;
  return { slug, demoId };
}

/** The theme segment for a store: `roast`, or `roast~foods`. */
export function previewThemeParam(slug: string, demoId: string): string {
  return demoId === PRIMARY_DEMO_ID ? slug : `${slug}${DEMO_SEPARATOR}${demoId}`;
}

export interface DemoFile {
  id: string;
  /** Absolute path. */
  path: string;
}

export function demoFilePath(themeDir: string, demoId: string): string {
  return demoId === PRIMARY_DEMO_ID ? join(themeDir, 'demo.json') : join(themeDir, 'demos', `${demoId}.json`);
}

/**
 * Every demo store on disk: the primary first, then `demos/*.json` by name.
 * Files whose name is not a valid id are listed too — the identity rule is
 * what rejects them, and it can only do that if it sees them.
 */
export function demoFilesOf(themeDir: string): DemoFile[] {
  const files: DemoFile[] = [];
  const primary = demoFilePath(themeDir, PRIMARY_DEMO_ID);
  if (existsSync(primary)) files.push({ id: PRIMARY_DEMO_ID, path: primary });

  const dir = join(themeDir, 'demos');
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith('.json')) continue;
    files.push({ id: entry.slice(0, -'.json'.length), path: join(dir, entry) });
  }

  return files;
}
