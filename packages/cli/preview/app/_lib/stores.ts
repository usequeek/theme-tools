import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PreviewDemoData } from '@usequeek/theme-kit/demo';
import { config, THEME_DIR } from '../../theme-entry';
import { groupStores, PRIMARY, type TemplateEntry } from './group-stores';

export { PRIMARY, type StoreEntry, type TemplateEntry } from './group-stores';

const DEMOS_DIR = join(THEME_DIR, 'demos');
/** A store id is a URL segment and a file name: lowercase letters, digits, single hyphens. */
const STORE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Every store your theme ships, by template: the main template first, each template's design 1 first. */
export function stores(): TemplateEntry[] {
  const files = existsSync(DEMOS_DIR)
    ? readdirSync(DEMOS_DIR).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length)).sort()
    : [];
  return groupStores(config, files);
}

/** One store's data, or null for an unknown id. Read on every request, so edits show on reload. */
export function loadStore(id: string): PreviewDemoData | null {
  if (!STORE_ID.test(id)) return null;
  const file = id === PRIMARY ? join(THEME_DIR, 'demo.json') : join(DEMOS_DIR, `${id}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf-8')) as PreviewDemoData;
}
