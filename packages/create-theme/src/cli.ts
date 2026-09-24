#!/usr/bin/env node
/**
 * npm create @usequeek/theme [dir] [-- flags]
 * (npm maps `npm create @usequeek/theme` to this package, @usequeek/create-theme.)
 * Exit codes: 0 done, 1 runtime failure, 2 usage, 130 cancelled.
 */
import { parseArgs } from 'node:util';
import { HELP, runCreate } from './index.js';
import { clackPrompter } from './prompts.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' }, templates: { type: 'string' }, primary: { type: 'string' },
    categories: { type: 'string' }, tags: { type: 'string' }, pages: { type: 'string' },
    ai: { type: 'string' }, 'no-ai': { type: 'boolean', default: false },
    pm: { type: 'string' }, 'no-install': { type: 'boolean', default: false }, 'no-git': { type: 'boolean', default: false },
    yes: { type: 'boolean', short: 'y', default: false }, 'dry-run': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false }, template: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !values.yes;
runCreate({
  dir: positionals[0], name: values.name, templates: values.templates, primary: values.primary,
  categories: values.categories, tags: values.tags, pages: values.pages, ai: values.ai, noAi: values['no-ai'],
  pm: values.pm, install: !values['no-install'], git: !values['no-git'], yes: values.yes,
  dryRun: values['dry-run'], force: values.force, template: values.template,
}, interactive ? clackPrompter() : null).catch((error: Error & { exitCode?: number }) => {
  console.error(`\n✖ ${error.message}`);
  process.exit(error.exitCode ?? 1);
});
