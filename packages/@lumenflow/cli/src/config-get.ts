#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file config-get.ts
 * WU-2186: Safe config:get CLI command for reading workspace.yaml values
 *
 * Uses routeConfigKey for consistent routing with config:set.
 * All keys must be fully qualified from workspace root.
 * No implicit software_delivery prefixing or fallback behavior.
 *
 * Usage:
 *   pnpm config:get --key software_delivery.methodology.testing
 *   pnpm config:get --key software_delivery.gates.minCoverage
 *   pnpm config:get --key control_plane.sync_interval
 */

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import YAML from 'yaml';
import { findProjectRoot, WRITABLE_ROOT_KEYS } from '@lumenflow/core/config';
import { die } from '@lumenflow/core/error-handler';
import { FILE_SYSTEM } from '@lumenflow/core/wu-constants';
import { runCLI } from './cli-entry-point.js';
import {
  parseConfigGetArgs,
  getConfigValue,
  routeConfigKey,
  loadPackConfigKeys,
  WORKSPACE_FILE_NAME,
} from './config-set.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[config:get]';
const WORKSPACE_INIT_COMMAND = 'pnpm workspace-init --yes';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigGetResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Core logic: applyConfigGet (pure, no side effects)
// ---------------------------------------------------------------------------

/**
 * Apply a config:get operation to a full workspace object.
 *
 * Routes the key using routeConfigKey (same as config:set) to determine
 * the correct read scope. No fallback to software_delivery for unqualified keys.
 *
 * @param workspace - Full workspace object (raw YAML parse)
 * @param key - Fully qualified dotpath key (e.g., "software_delivery.gates.minCoverage")
 * @param packConfigKeys - Map of config_key -> pack_id from loaded pack manifests
 * @returns Result with value or error
 */
export function applyConfigGet(
  workspace: Record<string, unknown>,
  key: string,
  packConfigKeys: Map<string, string>,
): ConfigGetResult {
  const route = routeConfigKey(key, packConfigKeys);

  switch (route.type) {
    case 'managed-error':
      return {
        ok: false,
        error: `Key "${route.rootKey}" is managed by a dedicated command. Use \`pnpm ${route.command}\` instead.`,
      };

    case 'unknown-error': {
      const hint = route.suggestion ? ` ${route.suggestion}` : '';
      return {
        ok: false,
        error: `Unknown root key "${route.rootKey}".${hint} Valid root keys: ${[...WRITABLE_ROOT_KEYS].join(', ')}, or a pack config_key (${[...packConfigKeys.keys()].join(', ')}).`,
      };
    }

    case 'workspace-root': {
      // Read from workspace root (e.g., control_plane.endpoint, memory_namespace)
      const value = getConfigValue(workspace, key);
      return { ok: true, value };
    }

    case 'pack-config': {
      // Read from workspace root using the fully-qualified key
      // (pack config is stored at workspace root under the config_key)
      const value = getConfigValue(workspace, key);
      return { ok: true, value };
    }
  }
}

// ---------------------------------------------------------------------------
// Main: config:get
// ---------------------------------------------------------------------------

export async function main(): Promise<void> {
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

  // Load pack config_keys from workspace for routing
  const packConfigKeys = loadPackConfigKeys(projectRoot, workspace);

  // Route and read using workspace-aware routing (no fallback)
  const result = applyConfigGet(workspace, options.key, packConfigKeys);

  if (!result.ok) {
    console.log(`${LOG_PREFIX} ${result.error}`);
    process.exitCode = 1;
    return;
  }

  if (result.value === undefined) {
    console.log(`${LOG_PREFIX} Key "${options.key}" is not set (undefined)`);
    process.exitCode = 0;
    return;
  }

  // Format output based on type
  if (typeof result.value === 'object' && result.value !== null) {
    console.log(YAML.stringify(result.value).trimEnd());
  } else {
    console.log(String(result.value));
  }
}

if (import.meta.main) {
  void runCLI(main);
}
