#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file config-set.ts
 * WU-1902 / WU-1973: Safe config:set CLI command for workspace.yaml modification
 *
 * Accepts dotpath keys and writes them to workspace.yaml under software_delivery.
 * Values are validated against the LumenFlow config schema before writing.
 *
 * Follows the lane:edit pattern (WU-1854).
 *
 * Usage:
 *   pnpm config:set --key software_delivery.methodology.testing --value test-after
 *   pnpm config:set --key software_delivery.gates.minCoverage --value 85
 *   pnpm config:set --key software_delivery.agents.methodology.principles --value Library-First,KISS
 */

import path from 'node:path';
import { createError, ErrorCodes } from '@lumenflow/core';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import YAML from 'yaml';
import type { ZodIssue } from 'zod';
import {
  findProjectRoot,
  WORKSPACE_CONFIG_FILE_NAME,
  clearConfigCache,
} from '@lumenflow/core/config';
import { die } from '@lumenflow/core/error-handler';
import { FILE_SYSTEM } from '@lumenflow/core/wu-constants';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { LumenFlowConfigSchema, WORKSPACE_V2_KEYS } from '@lumenflow/core/config-schema';
import { normalizeConfigKeys } from '@lumenflow/core/normalize-config-keys';
import { runCLI } from './cli-entry-point.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[config:set]';
const OPERATION_NAME = 'config-set';

const ARG_KEY = '--key';
const ARG_VALUE = '--value';
const ARG_HELP = '--help';

const COMMIT_PREFIX = 'chore: config:set';
const WORKSPACE_INIT_COMMAND = 'pnpm workspace-init --yes';
export const WORKSPACE_FILE_NAME = WORKSPACE_CONFIG_FILE_NAME;
export const WORKSPACE_CONFIG_ROOT_KEY = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;
export const WORKSPACE_CONFIG_PREFIX = `${WORKSPACE_CONFIG_ROOT_KEY}.`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfigSetOptions {
  key: string;
  value: string;
}

export interface ConfigGetOptions {
  key: string;
}

interface ConfigSetResult {
  ok: boolean;
  config?: Record<string, unknown>;
  error?: string;
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const SET_HELP_TEXT = `Usage: pnpm config:set --key <dotpath> --value <value>

Safely update ${WORKSPACE_FILE_NAME} via micro-worktree commit.
Validates against Zod schema before writing.

Required:
  ${ARG_KEY} <dotpath>    Config key in dot notation (e.g., software_delivery.methodology.testing)
  ${ARG_VALUE} <value>    Value to set (comma-separated for arrays)

Examples:
  pnpm config:set --key software_delivery.methodology.testing --value test-after
  pnpm config:set --key software_delivery.gates.minCoverage --value 85
  pnpm config:set --key software_delivery.agents.methodology.principles --value Library-First,KISS
`;

const GET_HELP_TEXT = `Usage: pnpm config:get --key <dotpath>

Read and display a value from ${WORKSPACE_FILE_NAME}.

Required:
  ${ARG_KEY} <dotpath>    Config key in dot notation (e.g., software_delivery.methodology.testing)

Examples:
  pnpm config:get --key software_delivery.methodology.testing
  pnpm config:get --key software_delivery.gates.minCoverage
`;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export function parseConfigSetArgs(argv: string[]): ConfigSetOptions {
  if (argv.includes(ARG_HELP)) {
    console.log(SET_HELP_TEXT);
    process.exit(0);
  }

  let key: string | undefined;
  let value: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case ARG_KEY:
        key = next;
        i++;
        break;
      case ARG_VALUE:
        value = next;
        i++;
        break;
      default:
        break;
    }
  }

  if (!key) {
    throw createError(
      ErrorCodes.INVALID_ARGUMENT,
      `${ARG_KEY} is required. Run with ${ARG_HELP} for usage.`,
    );
  }

  if (value === undefined) {
    throw createError(
      ErrorCodes.INVALID_ARGUMENT,
      `${ARG_VALUE} is required. Run with ${ARG_HELP} for usage.`,
    );
  }

  return { key, value };
}

export function parseConfigGetArgs(argv: string[]): ConfigGetOptions {
  if (argv.includes(ARG_HELP)) {
    console.log(GET_HELP_TEXT);
    process.exit(0);
  }

  let key: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === ARG_KEY) {
      key = next;
      i++;
    }
  }

  if (!key) {
    throw createError(
      ErrorCodes.INVALID_ARGUMENT,
      `${ARG_KEY} is required. Run with ${ARG_HELP} for usage.`,
    );
  }

  return { key };
}

/**
 * Normalize a user-provided key to software_delivery-relative dotpath.
 *
 * Supported key forms:
 * - `software_delivery.methodology.testing` (canonical)
 * - `methodology.testing` (shorthand; automatically scoped)
 *
 * @param key - User-provided config key
 * @returns Dotpath relative to software_delivery
 */
export function normalizeWorkspaceConfigKey(key: string): string {
  if (key === WORKSPACE_CONFIG_ROOT_KEY) {
    return '';
  }
  if (key.startsWith(WORKSPACE_CONFIG_PREFIX)) {
    return key.slice(WORKSPACE_CONFIG_PREFIX.length);
  }
  return key;
}

// ---------------------------------------------------------------------------
// Dotpath helpers (pure, no side effects)
// ---------------------------------------------------------------------------

/**
 * Get a value from a nested object using dot notation.
 *
 * @param obj - The object to traverse
 * @param dotpath - Dot-separated key path (e.g., "methodology.testing")
 * @returns The value at the path, or undefined if not found
 */
export function getConfigValue(obj: Record<string, unknown>, dotpath: string): unknown {
  const segments = dotpath.split('.');
  let current: unknown = obj;

  for (const segment of segments) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/**
 * Set a value in a nested object using dot notation.
 * Creates intermediate objects as needed.
 *
 * @param obj - The object to modify (will be deep-cloned)
 * @param dotpath - Dot-separated key path
 * @param value - The value to set
 * @returns A new object with the value set
 */
function setNestedValue(
  obj: Record<string, unknown>,
  dotpath: string,
  value: unknown,
): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  const segments = dotpath.split('.');
  let current: Record<string, unknown> = result;

  for (let i = 0; i < segments.length - 1; i++) {
    const segment = segments[i];
    if (
      current[segment] === undefined ||
      current[segment] === null ||
      typeof current[segment] !== 'object'
    ) {
      current[segment] = {};
    }
    current = current[segment] as Record<string, unknown>;
  }

  const lastSegment = segments[segments.length - 1];
  current[lastSegment] = value;

  return result;
}

/**
 * Coerce a string value to the appropriate type based on context.
 *
 * @param value - String value from CLI
 * @param existingValue - Current value at the target path (for type inference)
 * @returns Coerced value
 */
function coerceValue(value: string, existingValue: unknown): unknown {
  // Boolean coercion
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Number coercion (if existing value is a number or value looks numeric)
  if (typeof existingValue === 'number' || /^\d+(\.\d+)?$/.test(value)) {
    const numValue = Number(value);
    if (!isNaN(numValue)) return numValue;
  }

  // Array handling: if existing value is an array, comma-separated values
  // are appended to the array
  if (Array.isArray(existingValue)) {
    const newItems = value.split(',').map((s) => s.trim());
    return [...existingValue, ...newItems];
  }

  // String value
  return value;
}

// ---------------------------------------------------------------------------
// Core logic: applyConfigSet (pure, validates via Zod)
// ---------------------------------------------------------------------------

/**
 * Apply a config:set operation to a config object.
 *
 * 1. Coerces the string value to the appropriate type
 * 2. Sets the value at the dotpath
 * 3. Normalizes keys for Zod compatibility
 * 4. Validates the resulting config against the Zod schema
 *
 * @param config - Current config object (raw YAML parse, not yet Zod-parsed)
 * @param dotpath - Dot-separated key path
 * @param rawValue - String value from CLI
 * @returns Result with updated config or error
 */
export function applyConfigSet(
  config: Record<string, unknown>,
  dotpath: string,
  rawValue: string,
): ConfigSetResult {
  // Get existing value for type inference
  const existingValue = getConfigValue(config, dotpath);

  // Coerce value
  const coercedValue = coerceValue(rawValue, existingValue);

  // Set value in config
  const updatedConfig = setNestedValue(config, dotpath, coercedValue);

  // Normalize keys for Zod compatibility (snake_case -> camelCase)
  const normalized = normalizeConfigKeys(updatedConfig);

  // Validate against Zod schema
  const parseResult = LumenFlowConfigSchema.safeParse(normalized);

  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map((issue: ZodIssue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    return {
      ok: false,
      error: `Validation failed for ${dotpath}=${rawValue}: ${issues}`,
    };
  }

  // Return the updated raw config (not the Zod-parsed one, to preserve YAML structure)
  return { ok: true, config: updatedConfig };
}

// ---------------------------------------------------------------------------
// Config I/O helpers
// ---------------------------------------------------------------------------

/**
 * Read workspace YAML as object.
 *
 * @param workspacePath - Absolute path to workspace.yaml
 * @returns Parsed workspace object
 */
function readRawWorkspace(workspacePath: string): Record<string, unknown> {
  const content = readFileSync(workspacePath, FILE_SYSTEM.UTF8 as BufferEncoding);
  const parsed = YAML.parse(content) as Record<string, unknown> | null;
  return parsed && typeof parsed === 'object' ? parsed : {};
}

/**
 * Write workspace object back to YAML.
 *
 * @param workspacePath - Absolute path to workspace.yaml
 * @param workspace - Workspace object to persist
 */
function writeRawWorkspace(workspacePath: string, workspace: Record<string, unknown>): void {
  const nextContent = YAML.stringify(workspace);
  writeFileSync(workspacePath, nextContent, FILE_SYSTEM.UTF8 as BufferEncoding);
}

/**
 * Extract software_delivery config section from workspace object.
 *
 * @param workspace - Parsed workspace object
 * @returns software_delivery config object (empty when unset/invalid)
 */
export function getSoftwareDeliveryConfigFromWorkspace(
  workspace: Record<string, unknown>,
): Record<string, unknown> {
  const section = workspace[WORKSPACE_CONFIG_ROOT_KEY];
  if (!section || typeof section !== 'object' || Array.isArray(section)) {
    return {};
  }
  return section as Record<string, unknown>;
}

/**
 * Return a new workspace object with updated software_delivery section.
 *
 * @param workspace - Existing workspace object
 * @param config - Updated software_delivery config object
 * @returns New workspace object with replaced software_delivery section
 */
export function setSoftwareDeliveryConfigInWorkspace(
  workspace: Record<string, unknown>,
  config: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...workspace,
    [WORKSPACE_CONFIG_ROOT_KEY]: config,
  };
}

// ---------------------------------------------------------------------------
// Main: config:set
// ---------------------------------------------------------------------------

export async function main(): Promise<void> {
  const userArgs = process.argv.slice(2);
  const options = parseConfigSetArgs(userArgs);
  const configKey = normalizeWorkspaceConfigKey(options.key);
  if (!configKey) {
    die(
      `${LOG_PREFIX} Key must target a nested field under ${WORKSPACE_CONFIG_ROOT_KEY} (e.g., ${WORKSPACE_CONFIG_PREFIX}methodology.testing).`,
    );
  }

  const projectRoot = findProjectRoot();
  const workspacePath = path.join(projectRoot, WORKSPACE_FILE_NAME);

  if (!existsSync(workspacePath)) {
    die(`${LOG_PREFIX} Missing ${WORKSPACE_FILE_NAME}. Run \`${WORKSPACE_INIT_COMMAND}\` first.`);
  }

  console.log(
    `${LOG_PREFIX} Setting ${options.key}=${options.value} in ${WORKSPACE_FILE_NAME} via micro-worktree isolation`,
  );

  // Use micro-worktree to make atomic changes
  await withMicroWorktree({
    operation: OPERATION_NAME,
    id: `config-set-${Date.now()}`,
    logPrefix: LOG_PREFIX,
    pushOnly: true,
    async execute({ worktreePath }) {
      const workspaceRelPath = WORKSPACE_FILE_NAME;
      const mwWorkspacePath = path.join(worktreePath, workspaceRelPath);

      if (!existsSync(mwWorkspacePath)) {
        die(`${LOG_PREFIX} Config file not found in micro-worktree: ${workspaceRelPath}`);
      }

      // Read workspace and extract software_delivery config section
      const workspace = readRawWorkspace(mwWorkspacePath);
      const softwareDeliveryConfig = getSoftwareDeliveryConfigFromWorkspace(workspace);

      // Apply set
      const result = applyConfigSet(softwareDeliveryConfig, configKey, options.value);
      if (!result.ok) {
        die(`${LOG_PREFIX} ${result.error}`);
      }

      // Write updated workspace with replaced software_delivery section
      const updatedWorkspace = setSoftwareDeliveryConfigInWorkspace(workspace, result.config!);
      writeRawWorkspace(mwWorkspacePath, updatedWorkspace);

      console.log(`${LOG_PREFIX} Config validated and written successfully.`);

      return {
        commitMessage: `${COMMIT_PREFIX} ${options.key}=${options.value}`,
        files: [workspaceRelPath],
      };
    },
  });

  // WU-2126: Invalidate config cache so subsequent commands in the same process
  // read fresh values from disk after config mutation.
  clearConfigCache();

  console.log(`${LOG_PREFIX} Successfully set ${options.key}=${options.value}`);
}

if (import.meta.main) {
  void runCLI(main);
}
