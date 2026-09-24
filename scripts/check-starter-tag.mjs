// Run first by `pnpm release`, before anything is published. @usequeek/create-theme
// downloads github:usequeek/theme-starter#v<its version> (packages/create-theme/src/index.ts,
// STARTER), so releasing a version with no matching starter tag would make every
// `npm create @usequeek/theme` of it fail. The tag is made from the storefront by
// `yarn starter:publish --tag v<version>`.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const STARTER_REPO = 'https://github.com/usequeek/theme-starter';
const manifest = resolve(import.meta.dirname, '../packages/create-theme/package.json');
const { version } = JSON.parse(readFileSync(manifest, 'utf8'));
const tag = `v${version}`;

const result = spawnSync('git', ['ls-remote', '--exit-code', '--tags', STARTER_REPO, `refs/tags/${tag}`], { encoding: 'utf8' });
if (result.status === 0) {
  console.log(`check-starter-tag: usequeek/theme-starter has ${tag}, the starter @usequeek/create-theme@${version} downloads.`);
  process.exit(0);
}

// --exit-code: 2 means the repository answered and has no such tag; anything else is git or the network.
const why = result.status === 2
  ? `usequeek/theme-starter has no tag ${tag}, and @usequeek/create-theme@${version} downloads exactly that tag.`
  : `could not read usequeek/theme-starter's tags (${(result.error?.message ?? result.stderr.trim()) || `git exited ${result.status}`}).`;
console.error(`✖ check-starter-tag: ${why}\n  Publish the starter first: in the storefront, run \`yarn starter:publish --tag ${tag}\`.`);
process.exit(1);
