import * as p from '@clack/prompts';
import type { Prompter } from './options.js';
import { CancelledError } from './options.js';

function answer<T>(value: T | symbol): T {
  if (p.isCancel(value)) throw new CancelledError('Cancelled. Nothing was written.');
  return value as T;
}

export function clackPrompter(): Prompter {
  return {
    async slug(initial, problem) {
      for (;;) {
        const typed = answer<string>(
          await p.text({ message: 'App slug', placeholder: initial, defaultValue: initial, validate: (value) => problem(value?.trim() || initial) }),
        );
        const slug = typed.trim() || initial;
        const issue = problem(slug);
        if (issue === undefined) return slug;
        p.log.warn(issue);
      }
    },
    async name(initial, problem) {
      for (;;) {
        const typed = answer<string>(
          await p.text({ message: 'Display name', placeholder: initial, defaultValue: initial, validate: (value) => problem(value?.trim() || initial) }),
        );
        const name = typed.trim() || initial;
        const issue = problem(name);
        if (issue === undefined) return name;
        p.log.warn(issue);
      }
    },
  };
}
