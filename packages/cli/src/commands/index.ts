import Check from './check.js';
import Dev from './dev.js';
import Info from './info.js';
import Init from './init.js';
import Package from './package.js';
import Screenshot from './screenshot.js';

/**
 * Every command, listed explicitly (oclif's `explicit` strategy) rather than
 * discovered by scanning dist/commands at runtime — the scan found nothing on
 * Windows ("command check not found"), and a list is also faster to load.
 * Ids carry the `theme` topic straight (`queek theme dev`, …): one package,
 * no mapping layer.
 */
export const COMMANDS = {
  'theme:check': Check,
  'theme:dev': Dev,
  'theme:info': Info,
  'theme:init': Init,
  'theme:package': Package,
  'theme:screenshot': Screenshot,
};
