#!/usr/bin/env node
import { execute } from '@oclif/core';
import { applyUpdateCheckEnv } from '../dist/lib/update-check.js';

applyUpdateCheckEnv(process.env);

// This bin stays as an alias for existing projects; the CLI moved to `queek
// theme`. Stderr only, so `--json` stdout still parses.
process.stderr.write('`queek-theme` is now `queek theme` — npm install -D @usequeek/cli\n');

await execute({ dir: import.meta.url });
