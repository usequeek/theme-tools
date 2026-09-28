#!/usr/bin/env node
import { execute } from '@oclif/core';
import { applyUpdateCheckEnv } from '../dist/lib/update-check.js';

applyUpdateCheckEnv(process.env);

await execute({ dir: import.meta.url });
