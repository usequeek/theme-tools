import AddDesign from './add/design.js';
import AddPage from './add/page.js';
import AddTemplate from './add/template.js';
import Check from './check.js';
import Dev from './dev.js';
import Info from './info.js';
import Init from './init.js';
import Package from './package.js';
import Screenshot from './screenshot.js';
import AuthLogin from './auth/login.js';
import AuthLogout from './auth/logout.js';
import AuthStatus from './auth/status.js';
import AppInit from './app/init.js';
import AppCodegen from './app/codegen.js';
import AppDev from './app/dev.js';
import AppDevClean from './app/dev/clean.js';
import AppInfo from './app/info.js';
import AppDeploy from './app/deploy.js';
import AppConfigLink from './app/config/link.js';
import AppVersionsList from './app/versions/list.js';
import AppRelease from './app/release.js';
import AppSubmit from './app/submit.js';
import AppWithdraw from './app/withdraw.js';
import AppIcon from './app/icon.js';
import AppInstall from './app/install.js';
import AppEnvPull from './app/env/pull.js';
import AppReviewReply from './app/review/reply.js';
import DevStoreList from './dev-store/list.js';
import DevStoreCreate from './dev-store/create.js';
import DevStoreTestData from './dev-store/test-data.js';

/**
 * Every command, listed explicitly (oclif's `explicit` strategy) rather than
 * discovered by scanning dist/commands at runtime — the scan found nothing on
 * Windows ("command check not found"), and a list is also faster to load.
 * Ids carry the topic straight (`queek theme dev`, `queek app dev`, …):
 * one package, no mapping layer. The three `theme:add:*` ids read
 * `queek theme add template|design|page` (the topic separator is a space).
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
  'auth:login': AuthLogin,
  'auth:logout': AuthLogout,
  'auth:status': AuthStatus,
  'app:init': AppInit,
  'app:codegen': AppCodegen,
  'app:dev': AppDev,
  'app:dev:clean': AppDevClean,
  'app:info': AppInfo,
  'app:deploy': AppDeploy,
  'app:config:link': AppConfigLink,
  'app:versions:list': AppVersionsList,
  'app:release': AppRelease,
  'app:submit': AppSubmit,
  'app:withdraw': AppWithdraw,
  'app:icon': AppIcon,
  'app:install': AppInstall,
  'app:env:pull': AppEnvPull,
  'app:review:reply': AppReviewReply,
  'dev-store:list': DevStoreList,
  'dev-store:create': DevStoreCreate,
  'dev-store:test-data': DevStoreTestData,
};
