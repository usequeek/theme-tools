import Check from './check.js';
import Dev from './dev.js';
import Init from './init.js';
import Package from './package.js';

/**
 * Every command, listed explicitly (oclif's `explicit` strategy) rather than
 * discovered by scanning dist/commands at runtime — the scan found nothing on
 * Windows ("command check not found"), and a list is also faster to load.
 */
export const COMMANDS = {
  check: Check,
  dev: Dev,
  init: Init,
  package: Package,
};
