/**
 * The new-version notice never fires in CI: it would spam every pull-request
 * log, and a pinned CI install cannot act on it anyway.
 */

/** A CI-ish env value counts when set to anything but `''`/`'false'`/`'0'`. */
const isSet = (value: string | undefined): boolean =>
  value !== undefined && value !== '' && value !== 'false' && value !== '0';

/**
 * Point oclif's update check away when running automated: sets
 * `QUEEK_SKIP_NEW_VERSION_CHECK` (the variable oclif reads for the `queek`
 * bin) when `CI` is set, or when `QUEEK_NO_UPDATE_CHECK` is set.
 */
export function applyUpdateCheckEnv(env: NodeJS.ProcessEnv): void {
  if (isSet(env.CI) || isSet(env.QUEEK_NO_UPDATE_CHECK)) {
    env.QUEEK_SKIP_NEW_VERSION_CHECK = 'true';
  }
}
