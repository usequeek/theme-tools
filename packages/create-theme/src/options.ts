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
  /** Ask until `problem` has nothing to say about the name: a bad name must never end the run. */
  name(initial: string, problem: (name: string) => string | undefined): Promise<string>;
  templates(): Promise<string[]>;
  primary(keys: string[]): Promise<string>;
  categories(initial: string[]): Promise<string[]>;
  /** Ask until `problem` has nothing to say about the picks. */
  tags(problem: (tags: string[]) => string | undefined): Promise<string[]>;
  pages(initial: OptionalPage[]): Promise<OptionalPage[]>;
  ai(initial: Assistant[]): Promise<Assistant[]>;
}

const PAGES: readonly OptionalPage[] = ['contact', 'faq'];
const ASSISTANTS: readonly Assistant[] = ['claude', 'gemini'];

/** A comma-separated flag: trimmed, each value once, in the order first given. */
const csv = (value: string | undefined): string[] | undefined =>
  value === undefined ? undefined : [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];

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

/** Why a typed theme name cannot be used, or null. */
export function nameProblem(name: string): string | null {
  if (name.trim().length < 2) return 'At least 2 characters.';
  return slugProblem(slugify(name));
}

const tagsProblem = (tags: string[]): string | undefined => (tags.length < 1 || tags.length > 6 ? 'Pick 1 to 6 tags.' : undefined);

/**
 * Every answer, from its flag when given, else the prompt (in a terminal), else the default or a usage error.
 * Every flag is checked before the first question, and a question only accepts a usable answer,
 * so no answer is lost after it is given. `folderProblem` (a folder named after the slug) is checked
 * with the name.
 */
export async function resolveAnswers(flags: Flags, prompter: Prompter | null, folderProblem?: (slug: string) => string | null): Promise<Answers> {
  // Flags first: a typo in one must not cost the answers to the questions before it.
  const keyFlag = csv(flags.templates);
  if (keyFlag) {
    if (keyFlag.length === 0) throw new UsageError('Pick at least one business for --templates.');
    checkAll('business', '--templates', keyFlag, BUSINESS_KEYS);
  }
  if (flags.primary !== undefined) checkAll('business', '--primary', [flags.primary], BUSINESS_KEYS);
  const categoryFlag = csv(flags.categories);
  if (categoryFlag) {
    if (categoryFlag.length === 0) throw new UsageError('Pick at least one business category for --categories.');
    checkAll('category', '--categories', categoryFlag, SERVICES);
  }
  const tagFlag = csv(flags.tags);
  if (tagFlag) {
    if (tagsProblem(tagFlag)) throw new UsageError('Pick 1 to 6 --tags.');
    checkAll('tag', '--tags', tagFlag, TAGS);
  }
  const pageFlag = csv(flags.pages);
  if (pageFlag && pageFlag.includes('none') && pageFlag.length > 1) {
    throw new UsageError('--pages none cannot be combined with other pages.');
  }
  const pageAnswer = pageFlag?.[0] === 'none' ? [] : pageFlag ? checkAll('page', '--pages', pageFlag, PAGES) : undefined;
  const aiFlag = csv(flags.ai);
  const aiAnswer = flags.noAi ? false : aiFlag ? checkAll('assistant', '--ai', aiFlag, ASSISTANTS) : undefined;

  const initial = basename(resolve(flags.dir ?? 'my-theme'));
  const problemOf = (name: string): string | undefined => (nameProblem(name) ?? folderProblem?.(slugify(name))) ?? undefined;
  const name = flags.name ?? (prompter ? await prompter.name(initial, problemOf) : initial);
  const slug = slugify(name);
  const problem = slugProblem(slug) ?? folderProblem?.(slug);
  if (problem) throw new UsageError(problem);

  const keys = keyFlag ?? (prompter ? await prompter.templates() : required('--templates', BUSINESS_KEYS));
  if (keys.length === 0) throw new UsageError('Pick at least one business for --templates.');
  checkAll('business', '--templates', keys, BUSINESS_KEYS);

  const unique = [...new Set(keys)];
  const primary = flags.primary ?? (prompter && unique.length > 1 && flags.templates === undefined ? await prompter.primary(unique) : unique[0]);
  if (!unique.includes(primary)) throw new UsageError(`--primary "${primary}" is not one of --templates (${unique.join(', ')}).`);
  const templates = planTemplates(unique, primary);

  const categories = categoryFlag
    ?? (prompter ? await prompter.categories(defaultCategories(templates.map((t) => t.key))) : defaultCategories(templates.map((t) => t.key)));
  if (categories.length === 0) throw new UsageError('Pick at least one business category for --categories.');
  checkAll('category', '--categories', categories, SERVICES);

  const tags = tagFlag ?? (prompter ? await prompter.tags(tagsProblem) : required('--tags', TAGS));
  if (tags.length === 0 || tags.length > 6) throw new UsageError('Pick 1 to 6 --tags.');
  checkAll('tag', '--tags', tags, TAGS);

  const pages = pageAnswer ?? (prompter ? await prompter.pages([...PAGES]) : [...PAGES]);

  const ai = aiAnswer ?? (prompter ? await prompter.ai([...ASSISTANTS]) : [...ASSISTANTS]);

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
