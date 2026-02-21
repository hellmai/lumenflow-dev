#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file config-get.ts
 * WU-1902 / WU-1973: Safe config:get CLI command for reading workspace.yaml values
 *
 * Reads and displays current values from workspace.yaml using dotpath notation.
 * Canonical keys use the software_delivery prefix.
 *
 * Usage:
 *   pnpm config:get --key software_delivery.methodology.testing
 *   pnpm config:get --key software_delivery.gates.minCoverage
 */

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import YAML from 'yaml';
import { findProjectRoot } from '@lumenflow/core/config';
import { die } from '@lumenflow/core/error-handler';
import { FILE_SYSTEM } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';
import {
  parseConfigGetArgs,
  getConfigValue,
  normalizeWorkspaceConfigKey,
  WORKSPACE_FILE_NAME,
  WORKSPACE_CONFIG_PREFIX,
} from './config-set.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[config:get]';
const WORKSPACE_INIT_COMMAND = 'pnpm workspace-init --yes';

// ---------------------------------------------------------------------------
// Main: config:get
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const userArgs = process.argv.slice(2);
  const options = parseConfigGetArgs(userArgs);

  const projectRoot = findProjectRoot();
  const workspacePath = path.join(projectRoot, WORKSPACE_FILE_NAME);

  if (!existsSync(workspacePath)) {
    die(`${LOG_PREFIX} Missing ${WORKSPACE_FILE_NAME}. Run \`${WORKSPACE_INIT_COMMAND}\` first.`);
  }

  // Read raw workspace (preserving YAML structure, not Zod-parsed defaults)
  const content = readFileSync(workspacePath, FILE_SYSTEM.UTF8 as BufferEncoding);
  const workspace = (YAML.parse(content) as Record<string, unknown>) ?? {};

  // Canonical read path (full workspace key)
  let value = getConfigValue(workspace, options.key);
  if (value === undefined) {
    // Shorthand compatibility: methodology.testing -> software_delivery.methodology.testing
    const shorthandKey = normalizeWorkspaceConfigKey(options.key);
    if (shorthandKey !== options.key) {
      value = getConfigValue(workspace, `${WORKSPACE_CONFIG_PREFIX}${shorthandKey}`);
    } else {
      value = getConfigValue(workspace, `${WORKSPACE_CONFIG_PREFIX}${options.key}`);
    }
  }

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
