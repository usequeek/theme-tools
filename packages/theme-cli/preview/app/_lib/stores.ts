import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PreviewDemoData } from '@usequeek/theme-kit/demo';
import { config, THEME_DIR } from '../../theme-entry';

/** The id `theme/demo.json` goes by. Every other store is `theme/demos/<id>.json`. */
export const PRIMARY = 'default';

const DEMOS_DIR = join(THEME_DIR, 'demos');
/** A store id is a URL segment and a file name: lowercase letters, digits, single hyphens. */
const STORE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type Declared = { name?: string; default_demo?: { label?: string }; demos?: Array<{ id: string; label?: string }> };

export interface StoreEntry {
  id: string;
  label: string;
  /** Declared in theme.config.ts — an undeclared file is previewable here but rejected on submission. */
  declared: boolean;
}

/** Every store your theme ships — the primary first, then `theme/demos/*.json` by name. */
export function stores(): StoreEntry[] {
  const declared = config as Declared;
  const files = existsSync(DEMOS_DIR)
    ? readdirSync(DEMOS_DIR).filter((name) => name.endsWith('.json')).map((name) => name.slice(0, -'.json'.length)).sort()
    : [];
  return [
    { id: PRIMARY, label: declared.default_demo?.label ?? declared.name ?? 'Primary store', declared: true },
    ...files.map((id) => {
      const entry = declared.demos?.find((demo) => demo.id === id);
      return { id, label: entry?.label ?? id, declared: !!entry };
    }),
  ];
}

/** One store's data, or null for an unknown id. Read on every request, so edits show on reload. */
export function loadStore(id: string): PreviewDemoData | null {
  if (!STORE_ID.test(id)) return null;
  const file = id === PRIMARY ? join(THEME_DIR, 'demo.json') : join(DEMOS_DIR, `${id}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, 'utf-8')) as PreviewDemoData;
}
