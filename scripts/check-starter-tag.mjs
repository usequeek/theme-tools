// Run first by `pnpm release`, before anything is published. @usequeek/create-theme
// downloads github:usequeek/theme-starter#v<its version> (packages/create-theme/src/index.ts,
// STARTER), so two things must hold before a release, and a tag can never be moved
// afterwards:
//   1. the starter has that tag — otherwise every `npm create @usequeek/theme` of it fails;
//   2. the tagged starter's @usequeek/theme-cli range takes the theme-cli being released —
//      otherwise new projects install an older checker than the one Queek runs (0.3.0
//      shipped a starter that still said `^0.1.0 || ^0.2.0`).
// The tag is made from the storefront by `yarn starter:publish --tag v<version>`.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import semver from 'semver';

const STARTER_REPO = 'https://github.com/usequeek/theme-starter';
const read = (path) => JSON.parse(readFileSync(resolve(import.meta.dirname, '..', path), 'utf8'));
const { version } = read('packages/create-theme/package.json');
const { version: cliVersion } = read('packages/theme-cli/package.json');
const tag = `v${version}`;

function fail(why) {
  console.error(`✖ check-starter-tag: ${why}`);
  process.exit(1);
}

const result = spawnSync('git', ['ls-remote', '--exit-code', '--tags', STARTER_REPO, `refs/tags/${tag}`], { encoding: 'utf8' });
if (result.status !== 0) {
  // --exit-code: 2 means the repository answered and has no such tag; anything else is git or the network.
  fail(result.status === 2
    ? `usequeek/theme-starter has no tag ${tag}, and @usequeek/create-theme@${version} downloads exactly that tag.\n  Publish the starter first: in the storefront, run \`yarn starter:publish --tag ${tag}\`.`
    : `could not read usequeek/theme-starter's tags (${(result.error?.message ?? result.stderr.trim()) || `git exited ${result.status}`}).`);
}

const response = await fetch(`https://raw.githubusercontent.com/usequeek/theme-starter/${tag}/package.json`).catch((error) => fail(`could not read the starter's package.json at ${tag} (${error.message}).`));
if (!response.ok) fail(`could not read the starter's package.json at ${tag} (HTTP ${response.status}).`);
const starter = await response.json();
const range = starter.devDependencies?.['@usequeek/theme-cli'] ?? starter.dependencies?.['@usequeek/theme-cli'];
if (!range || !semver.satisfies(cliVersion, range)) {
  fail(`the starter at ${tag} asks for @usequeek/theme-cli "${range ?? '(missing)'}", which does not take ${cliVersion}, the version being released — new projects would install an older checker.\n  In the storefront, set packages/theme-starter/package.json's @usequeek/theme-cli range to take ${cliVersion} (e.g. "^${semver.major(cliVersion)}.${semver.minor(cliVersion)}.0"), then publish a new tag; a tag is never moved.`);
}

console.log(`check-starter-tag: usequeek/theme-starter has ${tag}, the starter @usequeek/create-theme@${version} downloads, and its @usequeek/theme-cli range "${range}" takes ${cliVersion}.`);
