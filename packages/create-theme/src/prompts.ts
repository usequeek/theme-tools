import * as p from '@clack/prompts';
import { NICHES, SERVICES, TAGS, categoryOf, labelOf } from './lists.js';
import { slugify } from './naming.js';
import { CancelledError, type Prompter } from './options.js';
import type { Assistant, OptionalPage } from './setup.js';

function answer<T>(value: T | symbol): T {
  if (p.isCancel(value)) throw new CancelledError('Cancelled. Nothing was written.');
  return value as T;
}

/**
 * Ask until the answer has no problem, warning each time and starting the next ask from the
 * last answer: clack 1.8's multiselect has no `validate`, and a bad pick must not end the run.
 */
export async function askUntil<T>(ask: (previous: T | undefined) => Promise<T>, problem: (value: T) => string | undefined, warn: (message: string) => void): Promise<T> {
  let previous: T | undefined;
  for (;;) {
    const value = await ask(previous);
    const issue = problem(value);
    if (issue === undefined) return value;
    warn(issue);
    previous = value;
  }
}

const businessOption = (key: string) => ({
  value: key,
  label: labelOf(key),
  hint: SERVICES.includes(key) ? 'business category' : `niche · ${labelOf(categoryOf(key))}`,
});

/** Business categories first, then niches: clack 1.8 has no grouped autocomplete, so each hint names its group. */
export const templateOptions = () => [...SERVICES, ...NICHES].map(businessOption);

export function clackPrompter(): Prompter {
  return {
    async name(initial, problem) {
      const typed = answer<string>(await p.text({ message: 'Theme name', placeholder: initial, defaultValue: initial, validate: (v) => problem(v?.trim() || initial) }));
      const name = typed.trim() || initial;
      p.log.info(`Slug: ${slugify(name)}`);
      return name;
    },
    async templates() {
      return answer<string[]>(await p.autocompleteMultiselect({ message: 'Businesses to make templates for (type to search)', options: templateOptions(), required: true }));
    },
    async primary(keys) {
      return answer<string>(await p.select({ message: 'Which is the primary template (the theme\'s first impression)?', options: keys.map(businessOption) }));
    },
    async categories(initial) {
      return answer<string[]>(await p.multiselect({ message: 'Business categories the theme serves', options: SERVICES.map((key) => ({ value: key, label: labelOf(key) })), initialValues: initial, required: true }));
    },
    async tags(problem) {
      return askUntil(
        async (previous) => answer<string[]>(await p.multiselect({ message: 'Tags: the look (1–6)', options: TAGS.map((tag) => ({ value: tag, label: tag })), initialValues: previous, required: true })),
        problem,
        (message) => p.log.warn(message),
      );
    },
    async pages(initial) {
      return answer<OptionalPage[]>(await p.multiselect<OptionalPage>({ message: 'Extra pages (about, sales and landing are always made)', options: [{ value: 'contact', label: 'Contact' }, { value: 'faq', label: 'FAQ' }], initialValues: initial, required: false }));
    },
    async ai(initial) {
      return answer<Assistant[]>(await p.multiselect<Assistant>({ message: 'AI assistants to set up (AGENTS.md is always written; Codex, Cursor and Copilot read it)', options: [{ value: 'claude', label: 'Claude Code' }, { value: 'gemini', label: 'Gemini CLI' }], initialValues: initial, required: false }));
    },
  };
}
