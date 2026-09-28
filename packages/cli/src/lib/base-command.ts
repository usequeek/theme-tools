import { Command, Flags } from '@oclif/core';

/**
 * What `check` and `package` share: the `--json` flag (the command's return
 * value is printed as JSON on stdout) and `--verbose` debug lines on stderr.
 * (`dev` and `init` stay on plain `Command`.)
 */
export abstract class BaseCommand extends Command {
  static override enableJsonFlag = true;

  static override baseFlags = {
    verbose: Flags.boolean({
      summary: 'Print debug lines to stderr.',
      default: false,
      env: 'QUEEK_THEME_VERBOSE',
    }),
  };

  private verboseOn = false;

  protected setVerbose(on: boolean | undefined): void {
    this.verboseOn = on === true;
  }

  /**
   * `[debug] line` on stderr, only when verbose. Written directly (not
   * through `logToStderr`, which oclif suppresses under `--json`), so stdout
   * stays one parseable object with `--json --verbose`. Overrides oclif's own
   * `debug` logger, which only fires under `DEBUG`.
   */
  protected override debug: (line: string) => void = (line: string): void => {
    if (this.verboseOn) process.stderr.write(`[debug] ${line}\n`);
  };
}
