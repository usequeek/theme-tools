import Check from './check.js';
import Dev from './dev.js';
import Init from './init.js';
import Package from './package.js';
import Screenshot from './screenshot.js';

/**
 * Every command, listed explicitly (oclif's `explicit` strategy) rather than
 * discovered by scanning dist/commands at runtime — the scan found nothing on
 * Windows ("command check not found"), and a list is also faster to load.
 *
 * `@usequeek/cli` maps these under its `theme` topic (`queek theme dev`);
 * this package's own oclif config keeps `COMMANDS` for its `queek-theme` bin.
 */
export const THEME_COMMANDS = {
  check: Check,
  dev: Dev,
  init: Init,
  package: Package,
  screenshot: Screenshot,
};

export const COMMANDS = THEME_COMMANDS;

export { applyUpdateCheckEnv } from '../lib/update-check.js';
