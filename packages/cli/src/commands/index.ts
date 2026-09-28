import Check from './check.js';
import Dev from './dev.js';
import Init from './init.js';
import Package from './package.js';
import Screenshot from './screenshot.js';
import Login from './login.js';
import Logout from './logout.js';
import AppInit from './app/init.js';
import AppDev from './app/dev.js';
import AppDeploy from './app/deploy.js';
import AppConfigLink from './app/config/link.js';
import AppVersionsList from './app/versions/list.js';
import AppRelease from './app/release.js';
import AppSubmit from './app/submit.js';

/**
 * Every command, listed explicitly (oclif's `explicit` strategy) rather than
 * discovered by scanning dist/commands at runtime — the scan found nothing on
 * Windows ("command check not found"), and a list is also faster to load.
 * Ids carry the topic straight (`queek theme dev`, `queek app dev`, …):
 * one package, no mapping layer.
 */
export const COMMANDS = {
  'theme:check': Check,
  'theme:dev': Dev,
  'theme:init': Init,
  'theme:package': Package,
  'theme:screenshot': Screenshot,
  login: Login,
  logout: Logout,
  'app:init': AppInit,
  'app:dev': AppDev,
  'app:deploy': AppDeploy,
  'app:config:link': AppConfigLink,
  'app:versions:list': AppVersionsList,
  'app:release': AppRelease,
  'app:submit': AppSubmit,
};
