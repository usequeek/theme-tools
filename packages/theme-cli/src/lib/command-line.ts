/**
 * The command as the developer runs it, for the bin in use: `queek theme
 * <name>` through the `queek` CLI (its `theme` topic), `queek-theme <name>`
 * through this package's own bin. Every user-facing string that names a
 * command goes through here, so both bins print the runnable form.
 */
export function commandLine(config: { bin: string }, name: string): string {
  return config.bin === 'queek' ? `queek theme ${name}` : `queek-theme ${name}`;
}
