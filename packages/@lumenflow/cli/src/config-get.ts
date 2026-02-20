#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file config-get.ts
 * WU-1902: Safe config:get CLI command for reading .lumenflow.config.yaml values
 *
 * Reads and displays current values from the config using dotpath notation.
 * Uses getConfig from @lumenflow/core/config for consistent config loading.
 *
 * Usage:
 *   pnpm config:get --key methodology.testing
 *   pnpm config:get --key gates.minCoverage
 */

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import YAML from 'yaml';
import { findProjectRoot } from '@lumenflow/core/config';
import { die } from '@lumenflow/core/error-handler';
import { CONFIG_FILES, FILE_SYSTEM } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';
import { parseConfigGetArgs, getConfigValue } from './config-set.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[config:get]';

// ---------------------------------------------------------------------------
// Main: config:get
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const userArgs = process.argv.slice(2);
  const options = parseConfigGetArgs(userArgs);

  const projectRoot = findProjectRoot();
  const configPath = path.join(projectRoot, CONFIG_FILES.LUMENFLOW_CONFIG);

  if (!existsSync(configPath)) {
    die(
      `${LOG_PREFIX} Missing ${CONFIG_FILES.LUMENFLOW_CONFIG}. Run \`pnpm exec lumenflow init\` first.`,
    );
  }

  // Read raw config (preserving YAML structure, not Zod-parsed)
  const content = readFileSync(configPath, FILE_SYSTEM.UTF8 as BufferEncoding);
  const config = (YAML.parse(content) as Record<string, unknown>) ?? {};

  const value = getConfigValue(config, options.key);

  if (value === undefined) {
    console.log(`${LOG_PREFIX} Key "${options.key}" is not set (undefined)`);
    process.exitCode = 0;
    return;
  }

  // Format output based on type
  if (typeof value === 'object' && value !== null) {
    console.log(YAML.stringify(value).trimEnd());
  } else {
    console.log(String(value));
  }
}

if (import.meta.main) {
  void runCLI(main);
}
