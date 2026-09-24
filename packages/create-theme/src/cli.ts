#!/usr/bin/env node
/**
 * npm create @usequeek/theme [dir] [--no-install]
 * (npm maps `npm create @usequeek/theme` to this package: @usequeek/create-theme.)
 */
import { parseArgs } from 'node:util';
import { createTheme } from './index.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    install: { type: 'boolean', default: true },
    'no-install': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help) {
  console.log('Usage: npm create @usequeek/theme [dir] [-- --no-install]\n\nCopies the Queek theme starter into dir (default: my-theme) and installs its dependencies.');
  process.exit(0);
}

createTheme({ dir: positionals[0] ?? 'my-theme', install: values.install && !values['no-install'] }).catch((error: Error) => {
  console.error(`\n✖ ${error.message}`);
  process.exit(1);
});
