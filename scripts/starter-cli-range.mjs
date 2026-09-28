// Pure, network-free: the starter's CLI dependency range a release checks.
// Kept in its own module so tests can cover the range logic without the
// network (`check-starter-tag.mjs` imports it).
export function startersCliRange(pkgJson) {
  return pkgJson?.devDependencies?.['@usequeek/cli'] ?? pkgJson?.dependencies?.['@usequeek/cli'];
}
