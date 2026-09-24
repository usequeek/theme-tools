import { basename, resolve } from 'node:path';
import { BUSINESS_KEYS, SERVICES, TAGS, nearest } from './lists.js';
import { defaultCategories, planTemplates, prefixFor, slugProblem, slugify } from './naming.js';
import type { Answers, Assistant, OptionalPage } from './setup.js';

export class UsageError extends Error {
  readonly exitCode = 2;
}
export class CancelledError extends Error {
  readonly exitCode = 130;
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface Flags {
  dir?: string;
  name?: string;
  templates?: string;
  primary?: string;
  categories?: string;
  tags?: string;
  pages?: string;
  ai?: string;
  noAi?: boolean;
  pm?: string;
  install: boolean;
  git: boolean;
  yes: boolean;
  dryRun: boolean;
  force: boolean;
  /** Where the starter comes from: a giget source or a local folder. Default: the pinned starter. */
  template?: string;
}

export interface Prompter {
  name(initial: string): Promise<string>;
  templates(): Promise<string[]>;
  primary(keys: string[]): Promise<string>;
  categories(initial: string[]): Promise<string[]>;
  tags(): Promise<string[]>;
  pages(initial: OptionalPage[]): Promise<OptionalPage[]>;
  ai(initial: Assistant[]): Promise<Assistant[]>;
}

const PAGES: readonly OptionalPage[] = ['contact', 'faq'];
const ASSISTANTS: readonly Assistant[] = ['claude', 'gemini'];

const csv = (value: string | undefined): string[] | undefined =>
  value === undefined ? undefined : value.split(',').map((item) => item.trim()).filter(Boolean);

function checkAll<T extends string>(kind: string, flag: string, values: string[], allowed: readonly T[]): T[] {
  for (const value of values) {
    if (allowed.includes(value as T)) continue;
    const hint = nearest(value, allowed);
    throw new UsageError(`Unknown ${kind} "${value}" in ${flag}${hint ? ` — did you mean "${hint}"?` : `. Choose from: ${allowed.join(', ')}`}`);
  }
  return values as T[];
}

function required(flag: string, allowed?: readonly string[]): never {
  throw new UsageError(`${flag} is required when not running in a terminal${allowed ? ` (choose from: ${allowed.join(', ')})` : ''}.`);
}

/** Every answer, from its flag when given, else the prompt (in a terminal), else the default or a usage error. */
export async function resolveAnswers(flags: Flags, prompter: Prompter | null): Promise<Answers> {
  const dir = flags.dir ?? 'my-theme';
  const name = flags.name ?? (prompter ? await prompter.name(basename(resolve(dir))) : basename(resolve(dir)));
  const slug = slugify(name);
  const problem = slugProblem(slug);
  if (problem) throw new UsageError(problem);

  const keys = csv(flags.templates) ?? (prompter ? await prompter.templates() : required('--templates', BUSINESS_KEYS));
  if (keys.length === 0) throw new UsageError('Pick at least one business for --templates.');
  checkAll('business', '--templates', keys, BUSINESS_KEYS);

  const unique = [...new Set(keys)];
  const primary = flags.primary ?? (prompter && unique.length > 1 && flags.templates === undefined ? await prompter.primary(unique) : unique[0]);
  if (!unique.includes(primary)) throw new UsageError(`--primary "${primary}" is not one of --templates (${unique.join(', ')}).`);
  const templates = planTemplates(unique, primary);

  const categories = csv(flags.categories)
    ?? (prompter ? await prompter.categories(defaultCategories(templates.map((t) => t.key))) : defaultCategories(templates.map((t) => t.key)));
  if (categories.length === 0) throw new UsageError('Pick at least one business category for --categories.');
  checkAll('category', '--categories', categories, SERVICES);

  const tags = csv(flags.tags) ?? (prompter ? await prompter.tags() : required('--tags', TAGS));
  if (tags.length === 0 || tags.length > 6) throw new UsageError('Pick 1 to 6 --tags.');
  checkAll('tag', '--tags', tags, TAGS);

  const pageFlag = csv(flags.pages);
  if (pageFlag && pageFlag.includes('none') && pageFlag.length > 1) {
    throw new UsageError('--pages none cannot be combined with other pages.');
  }
  const pages = pageFlag?.[0] === 'none' ? [] : pageFlag
    ? checkAll('page', '--pages', pageFlag, PAGES)
    : (prompter ? await prompter.pages([...PAGES]) : [...PAGES]);

  const ai = flags.noAi ? false : csv(flags.ai)
    ? checkAll('assistant', '--ai', csv(flags.ai)!, ASSISTANTS)
    : (prompter ? await prompter.ai([...ASSISTANTS]) : [...ASSISTANTS]);

  return { name, slug, prefix: prefixFor(slug), templates, categories, tags, pages, ai };
}

const quote = (text: string): string => `'${text.replace(/'/g, "'\\''")}'`;

const needsQuoting = (text: string): boolean => !/^[A-Za-z0-9._/-]+$/.test(text);

/** The command that repeats this setup without a single prompt. npm needs `--` before create's flags. */
export function equivalentCommand(pm: PackageManager, dir: string, answers: Answers): string {
  const quotedDir = needsQuoting(dir) ? quote(dir) : dir;
  const flags = [
    `--name ${quote(answers.name)}`,
    `--templates ${answers.templates.map((t) => t.key).join(',')}`,
    `--primary ${answers.templates[0].key}`,
    `--categories ${answers.categories.join(',')}`,
    `--tags ${answers.tags.join(',')}`,
    `--pages ${answers.pages.length ? answers.pages.join(',') : 'none'}`,
    answers.ai === false ? '--no-ai' : `--ai ${answers.ai.join(',')}`,
  ].join(' ');
  return pm === 'npm' ? `npm create @usequeek/theme@latest ${quotedDir} -- ${flags}` : `${pm} create @usequeek/theme ${quotedDir} ${flags}`;
}
