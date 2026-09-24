import * as p from '@clack/prompts';
import { BUSINESS_KEYS, SERVICES, TAGS, labelOf } from './lists.js';
import { CancelledError, type Prompter } from './options.js';
import type { Assistant, OptionalPage } from './setup.js';

function answer<T>(value: T | symbol): T {
  if (p.isCancel(value)) throw new CancelledError('Cancelled. Nothing was written.');
  return value as T;
}

const businessOption = (key: string) => ({ value: key, label: labelOf(key), hint: SERVICES.includes(key) ? 'whole business' : 'one kind of product' });

export function clackPrompter(): Prompter {
  return {
    async name(initial) {
      return answer<string>(await p.text({ message: 'Theme name', initialValue: initial, validate: (v) => (v && v.trim().length >= 2 ? undefined : 'At least 2 characters') }));
    },
    async templates() {
      return answer<string[]>(await p.autocompleteMultiselect({ message: 'Businesses to make templates for (type to search)', options: BUSINESS_KEYS.map(businessOption), required: true }));
    },
    async primary(keys) {
      return answer<string>(await p.select({ message: 'Which is the primary template (the theme\'s first impression)?', options: keys.map(businessOption) }));
    },
    async categories(initial) {
      return answer<string[]>(await p.multiselect({ message: 'Business categories the theme serves', options: SERVICES.map((key) => ({ value: key, label: labelOf(key) })), initialValues: initial, required: true }));
    },
    async tags() {
      return answer<string[]>(await p.multiselect({ message: 'Tags: the look (1–6)', options: TAGS.map((tag) => ({ value: tag, label: tag })), required: true }));
    },
    async pages(initial) {
      return answer<OptionalPage[]>(await p.multiselect<OptionalPage>({ message: 'Extra pages (about, sales and landing are always made)', options: [{ value: 'contact', label: 'Contact' }, { value: 'faq', label: 'FAQ' }], initialValues: initial, required: false }));
    },
    async ai(initial) {
      return answer<Assistant[]>(await p.multiselect<Assistant>({ message: 'AI assistants to set up (AGENTS.md is always written; Codex, Cursor and Copilot read it)', options: [{ value: 'claude', label: 'Claude Code' }, { value: 'gemini', label: 'Gemini CLI' }], initialValues: initial, required: false }));
    },
  };
}
