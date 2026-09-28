#!/usr/bin/env node
import { execute } from '@oclif/core';
import { applyUpdateCheckEnv } from '@usequeek/theme-cli/commands';

applyUpdateCheckEnv(process.env);

await execute({ dir: import.meta.url });
