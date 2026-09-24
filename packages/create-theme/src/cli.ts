#!/usr/bin/env node
/**
 * npm create @usequeek/theme [dir] [-- flags]
 * (npm maps `npm create @usequeek/theme` to this package, @usequeek/create-theme.)
 * Exit codes: 0 done, 1 runtime failure, 2 usage, 130 cancelled.
 */
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { HELP, runCreate } from './index.js';
import { nearest } from './lists.js';
import { UsageError } from './options.js';
import { clackPrompter } from './prompts.js';

const OPTIONS = {
  name: { type: 'string' }, templates: { type: 'string' }, primary: { type: 'string' },
  categories: { type: 'string' }, tags: { type: 'string' }, pages: { type: 'string' },
  ai: { type: 'string' }, 'no-ai': { type: 'boolean', default: false },
  pm: { type: 'string' }, 'no-install': { type: 'boolean', default: false }, 'no-git': { type: 'boolean', default: false },
  yes: { type: 'boolean', short: 'y', default: false }, 'dry-run': { type: 'boolean', default: false },
  force: { type: 'boolean', default: false }, template: { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
} satisfies ParseArgsOptionsConfig;

/** Node's strict parse errors, as a usage error a person can act on — never a stack trace. */
function usageFrom(error: Error & { code?: string }): UsageError | null {
  if (error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
    const flag = /Unknown option '([^']+)'/.exec(error.message)?.[1] ?? 'given';
    const hint = flag.startsWith('--') ? nearest(flag.slice(2), Object.keys(OPTIONS)) : null;
    return new UsageError(`Unknown flag ${flag}.${hint ? ` Did you mean --${hint}?` : ''}`);
  }
  if (error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE') {
    const flag = /--[\w-]+/.exec(error.message)?.[0] ?? 'This flag';
    return new UsageError(/does not take an argument/.test(error.message) ? `${flag} takes no value.` : `${flag} needs a value.`);
  }
  return null;
}

function fail(error: Error & { exitCode?: number }): never {
  console.error(`\n✖ ${error.message}`);
  process.exit(error.exitCode ?? 1);
}

let parsed: ReturnType<typeof parseArgs<{ allowPositionals: true; options: typeof OPTIONS }>>;
try {
  parsed = parseArgs({ allowPositionals: true, options: OPTIONS });
} catch (error) {
  fail(usageFrom(error as Error & { code?: string }) ?? (error as Error));
}
const { values, positionals } = parsed;

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
}, interactive ? clackPrompter() : null).catch(fail);
