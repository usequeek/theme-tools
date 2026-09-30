import { Args } from '@oclif/core';
import { appFlags } from '../../lib/app-command.js';
import { errorExitCode, MERCHANT_SPEC_URL, offlineStderr, runCodegen, type CodegenResult } from '../../lib/app-codegen.js';
import { BaseCommand } from '../../lib/base-command.js';

export default class AppCodegen extends BaseCommand {
  static override summary = 'Generate the app-owned Merchant API types from the live spec (manual, like graphql-codegen).';

  static override description = `Fetches the live Merchant spec (${MERCHANT_SPEC_URL}, or a URL/file you pass), sanity-checks it the way the SDK's gen:merchant does (OpenAPI 3.1.0 with an /orders/import path — HTML error pages refused), runs openapi-typescript, and writes types/merchant.ts plus the spec hash in .queek/codegen.json. No login needed: the spec is world-readable. Offline or unreachable spec: warns and exits 0, keeping existing types. A rerun with an unchanged spec writes nothing.`;

  static override examples = [
    '<%= config.bin %> <%= command.id %>',
    '<%= config.bin %> <%= command.id %> https://api.usequeek.com/docs/merchant.json',
    '<%= config.bin %> <%= command.id %> /tmp/merchant.json',
  ];

  static override args = {
    spec: Args.string({ description: `A spec URL or local file (default: ${MERCHANT_SPEC_URL}).` }),
  };

  static override flags = {
    path: appFlags.path,
    config: appFlags.config,
  };

  async run(): Promise<CodegenResult> {
    const { args, flags } = await this.parse(AppCodegen);
    this.setVerbose(flags.verbose as boolean | undefined);
    const result = await runCodegen({ appDir: flags.path, variant: flags.config, source: args.spec }).catch((error: Error) =>
      this.error(error.message, { exit: errorExitCode(error) }),
    );
    if (result.offline) {
      this.logToStderr(offlineStderr(result));
      return result;
    }
    if (result.unchanged) {
      this.log(`types/merchant.ts is already current (spec ${result.specSha256.slice(0, 12)}…) — nothing to do.`);
      return result;
    }
    this.log(`Wrote ${result.file} (${result.paths} paths, spec ${result.specSha256.slice(0, 12)}…) — hash recorded in ${result.recordFile}.`);
    return result;
  }
}
