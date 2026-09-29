import AddDesign from './add/design.js';
import AddPage from './add/page.js';
import AddTemplate from './add/template.js';
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
 * no mapping layer. The three `theme:add:*` ids read `queek theme add
 * template|design|page` (the topic separator is a space).
 */
export const COMMANDS = {
  'theme:add:design': AddDesign,
  'theme:add:page': AddPage,
  'theme:add:template': AddTemplate,
  'theme:check': Check,
  'theme:dev': Dev,
  'theme:info': Info,
  'theme:init': Init,
  'theme:package': Package,
  'theme:screenshot': Screenshot,
};
