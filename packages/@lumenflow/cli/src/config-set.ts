#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file config-set.ts
 * WU-2185: Workspace-aware config:set CLI command
 *
 * Routes keys by prefix:
 * - WRITABLE_ROOT_KEYS -> write at workspace root
 * - Pack config_key -> write under pack config block (validated against pack schema)
 * - MANAGED_ROOT_KEYS -> error with "use <command>" guidance
 * - Unknown -> hard error with did-you-mean
 *
 * All keys must be fully qualified from workspace root.
 * No implicit software_delivery prefixing.
 *
 * Usage:
 *   pnpm config:set --key software_delivery.methodology.testing --value test-after
 *   pnpm config:set --key software_delivery.gates.minCoverage --value 85
 *   pnpm config:set --key control_plane.sync_interval --value 60
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
import { WRITABLE_ROOT_KEYS, MANAGED_ROOT_KEYS, WORKSPACE_ROOT_KEYS } from '@lumenflow/core/config';
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

// ---------------------------------------------------------------------------
// Backward-compatible exports (deprecated, to be removed by WU-2186)
// config-get.ts imports these; removing them would break the build.
// ---------------------------------------------------------------------------

/** @deprecated WU-2185: Use fully-qualified keys. Will be removed by WU-2186. */
export const WORKSPACE_CONFIG_ROOT_KEY = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;

/** @deprecated WU-2185: Use fully-qualified keys. Will be removed by WU-2186. */
export const WORKSPACE_CONFIG_PREFIX = `${WORKSPACE_CONFIG_ROOT_KEY}.`;

/**
 * @deprecated WU-2185: No implicit prefixing. Use fully-qualified keys.
 * Will be removed by WU-2186.
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

/**
 * @deprecated WU-2185: Use workspace-aware routing. Will be removed by WU-2186.
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
 * @deprecated WU-2185: Use workspace-aware routing. Will be removed by WU-2186.
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

/**
 * Known sub-keys of LumenFlowConfigSchema (software_delivery pack config).
 * Used for did-you-mean suggestions when a user provides an unqualified key.
 */
const KNOWN_SD_SUBKEYS = [
  'version',
  'methodology',
  'gates',
  'directories',
  'state',
  'git',
  'wu',
  'memory',
  'ui',
  'yaml',
  'agents',
  'experimental',
  'cleanup',
  'telemetry',
  'cloud',
  'lanes',
  'escalation',
  'package_manager',
  'test_runner',
  'build_command',
] as const;

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

/** Route result from routeConfigKey */
export type ConfigKeyRoute =
  | { type: 'workspace-root'; rootKey: string; subPath: string }
  | { type: 'pack-config'; rootKey: string; subPath: string; packId: string }
  | { type: 'managed-error'; rootKey: string; command: string }
  | { type: 'unknown-error'; rootKey: string; suggestion?: string };

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const SET_HELP_TEXT = `Usage: pnpm config:set --key <dotpath> --value <value>

Safely update ${WORKSPACE_FILE_NAME} via micro-worktree commit.
Keys must be fully qualified from the workspace root.
Validates against schema before writing.

Required:
  ${ARG_KEY} <dotpath>    Config key in dot notation (fully qualified)
  ${ARG_VALUE} <value>    Value to set (comma-separated for arrays)

Examples:
  pnpm config:set --key software_delivery.methodology.testing --value test-after
  pnpm config:set --key software_delivery.gates.minCoverage --value 85
  pnpm config:set --key control_plane.sync_interval --value 60
  pnpm config:set --key memory_namespace --value my-project
`;

const GET_HELP_TEXT = `Usage: pnpm config:get --key <dotpath>

Read and display a value from ${WORKSPACE_FILE_NAME}.
Keys must be fully qualified from the workspace root.

Required:
  ${ARG_KEY} <dotpath>    Config key in dot notation (fully qualified)

Examples:
  pnpm config:get --key software_delivery.methodology.testing
  pnpm config:get --key software_delivery.gates.minCoverage
  pnpm config:get --key control_plane.sync_interval
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

// ---------------------------------------------------------------------------
// Key routing (pure, no side effects)
// ---------------------------------------------------------------------------

/**
 * Route a fully-qualified config key to the correct write target.
 *
 * Routing rules (checked in order):
 * 1. First segment in WRITABLE_ROOT_KEYS -> workspace-root
 * 2. First segment matches a pack config_key -> pack-config
 * 3. First segment in MANAGED_ROOT_KEYS -> managed-error
 * 4. Otherwise -> unknown-error (with optional did-you-mean suggestion)
 *
 * @param key - Fully qualified dotpath key (e.g., "software_delivery.gates.minCoverage")
 * @param packConfigKeys - Map of config_key -> pack_id from loaded pack manifests
 * @returns Route describing where/how to write the key
 */
export function routeConfigKey(key: string, packConfigKeys: Map<string, string>): ConfigKeyRoute {
  const segments = key.split('.');
  const firstSegment = segments[0];
  const subPath = segments.slice(1).join('.');

  // 1. Writable root keys (e.g., control_plane, memory_namespace, event_namespace)
  if (WRITABLE_ROOT_KEYS.has(firstSegment as (typeof WORKSPACE_ROOT_KEYS)[number])) {
    return { type: 'workspace-root', rootKey: firstSegment, subPath };
  }

  // 2. Pack config_key (e.g., software_delivery -> software-delivery pack)
  const packId = packConfigKeys.get(firstSegment);
  if (packId !== undefined) {
    return { type: 'pack-config', rootKey: firstSegment, subPath, packId };
  }

  // 3. Managed root keys (e.g., packs, lanes, security, id, name, policies)
  if (firstSegment in MANAGED_ROOT_KEYS) {
    const managedCommand = MANAGED_ROOT_KEYS[firstSegment];
    return { type: 'managed-error', rootKey: firstSegment, command: managedCommand };
  }

  // 4. Unknown key - check for did-you-mean suggestions
  const suggestion = buildDidYouMeanSuggestion(key, firstSegment, packConfigKeys);
  return { type: 'unknown-error', rootKey: firstSegment, suggestion };
}

/**
 * Build a did-you-mean suggestion for an unknown key.
 *
 * If the first segment matches a known sub-key of a pack config schema,
 * suggest the fully-qualified version.
 *
 * @param fullKey - The full user-provided key
 * @param firstSegment - The first segment of the key
 * @param packConfigKeys - Map of config_key -> pack_id
 * @returns A suggestion string, or undefined if no match
 */
function buildDidYouMeanSuggestion(
  fullKey: string,
  firstSegment: string,
  packConfigKeys: Map<string, string>,
): string | undefined {
  // Check if first segment is a known SD sub-key
  if ((KNOWN_SD_SUBKEYS as readonly string[]).includes(firstSegment)) {
    // Find the pack config_key that owns SD config
    for (const [configKey] of packConfigKeys) {
      return `Did you mean "${configKey}.${fullKey}"?`;
    }
  }
  return undefined;
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
 * Check if a string represents a numeric value (integer or decimal).
 * Uses Number() instead of regex to avoid unsafe regex patterns.
 */
function isNumericString(value: string): boolean {
  if (value === '' || value.trim() !== value) return false;
  const num = Number(value);
  return !isNaN(num) && isFinite(num);
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
  if (typeof existingValue === 'number' || isNumericString(value)) {
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
// Core logic: applyConfigSet (workspace-aware routing)
// ---------------------------------------------------------------------------

/**
 * Apply a config:set operation to a full workspace object.
 *
 * Routes the key by prefix, validates against the appropriate schema,
 * and returns the updated workspace or an error.
 *
 * @param workspace - Full workspace object (raw YAML parse)
 * @param key - Fully qualified dotpath key (e.g., "software_delivery.gates.minCoverage")
 * @param rawValue - String value from CLI
 * @param packConfigKeys - Map of config_key -> pack_id from loaded pack manifests
 * @returns Result with updated workspace or error
 */
export function applyConfigSet(
  workspace: Record<string, unknown>,
  key: string,
  rawValue: string,
  packConfigKeys: Map<string, string>,
): ConfigSetResult {
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

    case 'workspace-root':
      return applyWorkspaceRootSet(workspace, key, rawValue);

    case 'pack-config':
      return applyPackConfigSet(workspace, route, rawValue);
  }
}

/**
 * Apply a set operation at the workspace root level.
 * Used for WRITABLE_ROOT_KEYS like control_plane, memory_namespace, event_namespace.
 */
function applyWorkspaceRootSet(
  workspace: Record<string, unknown>,
  key: string,
  rawValue: string,
): ConfigSetResult {
  const existingValue = getConfigValue(workspace, key);
  const coercedValue = coerceValue(rawValue, existingValue);
  const updatedWorkspace = setNestedValue(workspace, key, coercedValue);
  return { ok: true, config: updatedWorkspace };
}

/**
 * Apply a set operation within a pack's config block.
 * Extracts the pack section, applies the change, validates via Zod schema,
 * then writes back into the workspace.
 */
function applyPackConfigSet(
  workspace: Record<string, unknown>,
  route: { rootKey: string; subPath: string; packId: string },
  rawValue: string,
): ConfigSetResult {
  // Extract the pack's config section
  const packSection = workspace[route.rootKey];
  const packConfig: Record<string, unknown> =
    packSection && typeof packSection === 'object' && !Array.isArray(packSection)
      ? (packSection as Record<string, unknown>)
      : {};

  if (!route.subPath) {
    return {
      ok: false,
      error: `Key must target a nested field under ${route.rootKey} (e.g., ${route.rootKey}.methodology.testing).`,
    };
  }

  // Get existing value for type inference
  const existingValue = getConfigValue(packConfig, route.subPath);

  // Coerce value
  const coercedValue = coerceValue(rawValue, existingValue);

  // Set value in pack config
  const updatedPackConfig = setNestedValue(packConfig, route.subPath, coercedValue);

  // Normalize keys for Zod compatibility (snake_case -> camelCase)
  const normalized = normalizeConfigKeys(updatedPackConfig);

  // Validate against LumenFlowConfigSchema (SD pack schema)
  const parseResult = LumenFlowConfigSchema.safeParse(normalized);

  if (!parseResult.success) {
    const issues = parseResult.error.issues
      .map((issue: ZodIssue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    return {
      ok: false,
      error: `Validation failed for ${route.rootKey}.${route.subPath}=${rawValue}: ${issues}`,
    };
  }

  // Write updated pack config back into workspace
  const updatedWorkspace = {
    ...workspace,
    [route.rootKey]: updatedPackConfig,
  };

  return { ok: true, config: updatedWorkspace };
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
 * Load pack config_keys from workspace packs field.
 * Reads pinned pack manifests to discover their declared config_key.
 *
 * @param projectRoot - Absolute path to project root
 * @param workspace - Parsed workspace object
 * @returns Map of config_key -> pack_id
 */
function loadPackConfigKeys(
  projectRoot: string,
  workspace: Record<string, unknown>,
): Map<string, string> {
  const result = new Map<string, string>();
  const packs = workspace.packs;

  if (!Array.isArray(packs)) {
    return result;
  }

  for (const pack of packs) {
    if (!pack || typeof pack !== 'object' || !('id' in pack)) {
      continue;
    }

    const packId = String(pack.id);
    const manifestPath = path.join(
      projectRoot,
      'packages',
      '@lumenflow',
      'packs',
      packId,
      'manifest.yaml',
    );

    if (!existsSync(manifestPath)) {
      continue;
    }

    try {
      const manifestContent = readFileSync(manifestPath, 'utf8');
      const manifest = YAML.parse(manifestContent) as Record<string, unknown>;
      if (manifest && typeof manifest.config_key === 'string') {
        result.set(manifest.config_key, packId);
      }
    } catch {
      // Skip unreadable manifests
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main: config:set
// ---------------------------------------------------------------------------

export async function main(): Promise<void> {
  const userArgs = process.argv.slice(2);
  const options = parseConfigSetArgs(userArgs);

  const projectRoot = findProjectRoot();
  const workspacePath = path.join(projectRoot, WORKSPACE_FILE_NAME);

  if (!existsSync(workspacePath)) {
    die(`${LOG_PREFIX} Missing ${WORKSPACE_FILE_NAME}. Run \`${WORKSPACE_INIT_COMMAND}\` first.`);
  }

  // Load pack config_keys from workspace for routing
  const rawWorkspace = readRawWorkspace(workspacePath);
  const packConfigKeys = loadPackConfigKeys(projectRoot, rawWorkspace);

  // Validate routing before starting micro-worktree
  const route = routeConfigKey(options.key, packConfigKeys);
  if (route.type === 'managed-error') {
    die(
      `${LOG_PREFIX} Key "${route.rootKey}" is managed by a dedicated command. Use \`pnpm ${route.command}\` instead.`,
    );
  }
  if (route.type === 'unknown-error') {
    const hint = route.suggestion ? ` ${route.suggestion}` : '';
    die(
      `${LOG_PREFIX} Unknown root key "${route.rootKey}".${hint} Valid root keys: ${[...WRITABLE_ROOT_KEYS].join(', ')}, or a pack config_key (${[...packConfigKeys.keys()].join(', ')}).`,
    );
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

      // Read full workspace
      const workspace = readRawWorkspace(mwWorkspacePath);

      // Re-load pack config keys from micro-worktree workspace
      const mwPackConfigKeys = loadPackConfigKeys(worktreePath, workspace);

      // Apply set with workspace-aware routing
      const result = applyConfigSet(workspace, options.key, options.value, mwPackConfigKeys);
      if (!result.ok) {
        die(`${LOG_PREFIX} ${result.error}`);
      }

      // Write updated workspace
      writeRawWorkspace(mwWorkspacePath, result.config!);

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
