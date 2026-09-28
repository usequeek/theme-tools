#!/usr/bin/env node
/**
 * npm create @usequeek/app [dir] [-- flags]
 * (npm maps `npm create @usequeek/app` to this package, @usequeek/create-app.)
 * Exit codes: 0 done, 1 runtime failure, 2 usage, 130 cancelled.
 */
import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { HELP, runCreate } from './index.js';
import { UsageError } from './options.js';
import { clackPrompter } from './prompts.js';

const OPTIONS = {
  slug: { type: 'string' }, name: { type: 'string' },
  pm: { type: 'string' }, 'no-install': { type: 'boolean', default: false }, 'no-git': { type: 'boolean', default: false },
  yes: { type: 'boolean', short: 'y', default: false }, 'dry-run': { type: 'boolean', default: false },
  force: { type: 'boolean', default: false }, template: { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
} satisfies ParseArgsOptionsConfig;

function fail(error: Error & { exitCode?: number }): never {
  console.error(`\n✖ ${error.message}`);
  process.exit(error.exitCode ?? 1);
}

let parsed: ReturnType<typeof parseArgs<{ allowPositionals: true; options: typeof OPTIONS }>>;
try {
  parsed = parseArgs({ allowPositionals: true, options: OPTIONS });
} catch (error) {
  fail((error as Error & { code?: string }).code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION'
    ? new UsageError(`Unknown flag. See --help.`)
    : (error as Error));
}
const { values, positionals } = parsed;

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !values.yes;
runCreate({
  dir: positionals[0], slug: values.slug, name: values.name,
  pm: values.pm, install: !values['no-install'], git: !values['no-git'], yes: values.yes,
  dryRun: values['dry-run'], force: values.force, template: values.template,
}, interactive ? clackPrompter() : null).catch(fail);
