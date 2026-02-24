#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file lane-edit.ts
 * WU-1854: Safe in-place lane definition editing via micro-worktree
 *
 * Enables editing lane definitions in workspace.yaml without
 * directly writing to main. Uses the micro-worktree isolation pattern
 * (WU-1262) to commit changes atomically.
 *
 * Supports: --rename, --wip-limit, --add-path, --remove-path, --description
 *
 * Usage:
 *   pnpm lane:edit --name 'Framework: CLI' --rename 'Framework: CLI WU Commands'
 *   pnpm lane:edit --name 'Feature: API' --wip-limit 3
 *   pnpm lane:edit --name 'Core: Domain' --add-path 'packages/events/'
 */

import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import YAML from 'yaml';
import { findProjectRoot, WORKSPACE_CONFIG_FILE_NAME } from '@lumenflow/core/config';
import { WORKSPACE_V2_KEYS } from '@lumenflow/core/config-schema';
import { createError, ErrorCodes } from '@lumenflow/core/error-handler';
import { die } from '@lumenflow/core/error-handler';
import { FILE_SYSTEM } from '@lumenflow/core/wu-constants';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { runCLI } from './cli-entry-point.js';
import { asRecord } from './object-guards.js';
import {
  validateLaneArtifacts,
  classifyLaneLifecycleForProject,
  LANE_LIFECYCLE_STATUS,
} from './lane-lifecycle-process.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[lane:edit]';
const OPERATION_NAME = 'lane-edit';

const ARG_NAME = '--name';
const ARG_RENAME = '--rename';
const ARG_WIP_LIMIT = '--wip-limit';
const ARG_ADD_PATH = '--add-path';
const ARG_REMOVE_PATH = '--remove-path';
const ARG_DESCRIPTION = '--description';
const ARG_HELP = '--help';

const COMMIT_PREFIX = 'chore: lane:edit';
const SOFTWARE_DELIVERY_KEY = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LaneDefinition {
  name: string;
  wip_limit?: number;
  code_paths?: string[];
  description?: string;
  wip_justification?: string;
  lock_policy?: string;
  [key: string]: unknown;
}

export interface LaneEditOptions {
  name: string;
  rename?: string;
  wipLimit?: number;
  addPaths?: string[];
  removePaths?: string[];
  description?: string;
}

interface LaneEditResult {
  ok: boolean;
  definitions?: LaneDefinition[];
  error?: string;
}

interface PreconditionResult {
  ok: boolean;
  error?: string;
}

interface ConfigDoc {
  lanes?: {
    definitions?: LaneDefinition[];
    lifecycle?: { status?: string };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

interface WorkspaceDoc {
  [SOFTWARE_DELIVERY_KEY]?: ConfigDoc;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

const HELP_TEXT = `Usage: pnpm lane:edit --name <lane> [options]

Edit a lane definition in workspace.yaml via micro-worktree commit.

Required:
  ${ARG_NAME} <name>          Target lane name (exact match)

Edit flags (at least one required):
  ${ARG_RENAME} <name>        Rename the lane
  ${ARG_WIP_LIMIT} <n>        Set WIP limit (positive integer)
  ${ARG_ADD_PATH} <path>      Add a code path (repeatable)
  ${ARG_REMOVE_PATH} <path>   Remove a code path (repeatable)
  ${ARG_DESCRIPTION} <text>   Set lane description

Examples:
  pnpm lane:edit --name 'Framework: CLI' --rename 'Framework: CLI WU Commands'
  pnpm lane:edit --name 'Feature: API' --wip-limit 3
  pnpm lane:edit --name 'Core: Domain' --add-path 'packages/events/'
`;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export function parseLaneEditArgs(argv: string[]): LaneEditOptions {
  if (argv.includes(ARG_HELP)) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  let name: string | undefined;
  let rename: string | undefined;
  let wipLimit: number | undefined;
  const addPaths: string[] = [];
  const removePaths: string[] = [];
  let description: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case ARG_NAME:
        name = next;
        i++;
        break;
      case ARG_RENAME:
        rename = next;
        i++;
        break;
      case ARG_WIP_LIMIT: {
        const parsed = parseInt(next, 10);
        if (isNaN(parsed) || parsed <= 0) {
          throw createError(
            ErrorCodes.INVALID_ARGUMENT,
            `${ARG_WIP_LIMIT} must be a positive integer, got: ${next}`,
          );
        }
        wipLimit = parsed;
        i++;
        break;
      }
      case ARG_ADD_PATH:
        addPaths.push(next);
        i++;
        break;
      case ARG_REMOVE_PATH:
        removePaths.push(next);
        i++;
        break;
      case ARG_DESCRIPTION:
        description = next;
        i++;
        break;
      default:
        break;
    }
  }

  if (!name) {
    throw createError(
      ErrorCodes.INVALID_ARGUMENT,
      `${ARG_NAME} is required. Run with ${ARG_HELP} for usage.`,
    );
  }

  const hasEdits =
    rename !== undefined ||
    wipLimit !== undefined ||
    addPaths.length > 0 ||
    removePaths.length > 0 ||
    description !== undefined;

  if (!hasEdits) {
    throw createError(
      ErrorCodes.INVALID_ARGUMENT,
      `At least one edit flag is required (${ARG_RENAME}, ${ARG_WIP_LIMIT}, ${ARG_ADD_PATH}, ${ARG_REMOVE_PATH}, ${ARG_DESCRIPTION}). Run with ${ARG_HELP} for usage.`,
    );
  }

  return {
    name,
    rename,
    wipLimit,
    addPaths: addPaths.length > 0 ? addPaths : undefined,
    removePaths: removePaths.length > 0 ? removePaths : undefined,
    description,
  };
}

// ---------------------------------------------------------------------------
// Precondition validation
// ---------------------------------------------------------------------------

export function validateLaneEditPreconditions(projectRoot: string): PreconditionResult {
  const configPath = path.join(projectRoot, WORKSPACE_CONFIG_FILE_NAME);
  if (!existsSync(configPath)) {
    return {
      ok: false,
      error: `${LOG_PREFIX} Missing ${WORKSPACE_CONFIG_FILE_NAME}. Run \`pnpm workspace-init --yes\` first.`,
    };
  }

  const classification = classifyLaneLifecycleForProject(projectRoot);
  const { status } = classification;

  if (status !== LANE_LIFECYCLE_STATUS.LOCKED && status !== LANE_LIFECYCLE_STATUS.DRAFT) {
    return {
      ok: false,
      error:
        `${LOG_PREFIX} Lane lifecycle status is "${status}". ` +
        `lane:edit requires lanes to be in locked or draft status. ` +
        `Run: pnpm lane:setup && pnpm lane:lock`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pure lane mutation logic (no side effects, testable)
// ---------------------------------------------------------------------------

export function applyLaneEdit(
  definitions: LaneDefinition[],
  options: LaneEditOptions,
): LaneEditResult {
  const { name, rename, wipLimit, addPaths, removePaths, description } = options;

  // Find the target lane
  const targetIndex = definitions.findIndex((d) => d.name === name);
  if (targetIndex === -1) {
    return {
      ok: false,
      error: `${LOG_PREFIX} Lane "${name}" not found in definitions.`,
    };
  }

  // Deep clone definitions to avoid mutating the input
  const updated = JSON.parse(JSON.stringify(definitions)) as LaneDefinition[];
  const target = updated[targetIndex];

  // Apply rename
  if (rename !== undefined) {
    // Check that new name doesn't already exist
    const nameConflict = updated.some((d, i) => i !== targetIndex && d.name === rename);
    if (nameConflict) {
      return {
        ok: false,
        error: `${LOG_PREFIX} Lane "${rename}" already exists. Cannot rename.`,
      };
    }
    target.name = rename;
  }

  // Apply wip_limit
  if (wipLimit !== undefined) {
    target.wip_limit = wipLimit;
  }

  // Apply add-path
  if (addPaths !== undefined) {
    const currentPaths = target.code_paths ?? [];
    for (const addPath of addPaths) {
      if (currentPaths.includes(addPath)) {
        return {
          ok: false,
          error: `${LOG_PREFIX} Path "${addPath}" already exists in code_paths for lane "${target.name}".`,
        };
      }
      currentPaths.push(addPath);
    }
    target.code_paths = currentPaths;
  }

  // Apply remove-path
  if (removePaths !== undefined) {
    const currentPaths = target.code_paths ?? [];
    for (const removePath of removePaths) {
      const pathIndex = currentPaths.indexOf(removePath);
      if (pathIndex === -1) {
        return {
          ok: false,
          error: `${LOG_PREFIX} Path "${removePath}" not found in code_paths for lane "${target.name}".`,
        };
      }
      currentPaths.splice(pathIndex, 1);
    }
    target.code_paths = currentPaths;
  }

  // Apply description
  if (description !== undefined) {
    target.description = description;
  }

  return { ok: true, definitions: updated };
}

// ---------------------------------------------------------------------------
// Config I/O helpers
// ---------------------------------------------------------------------------

function readConfigDoc(configPath: string): ConfigDoc {
  const content = readFileSync(configPath, FILE_SYSTEM.UTF8 as BufferEncoding);
  const workspace = asRecord(YAML.parse(content)) as WorkspaceDoc | null;
  if (!workspace) {
    return {};
  }
  return (asRecord(workspace[SOFTWARE_DELIVERY_KEY]) as ConfigDoc | null) ?? {};
}

function writeConfigDoc(configPath: string, config: ConfigDoc): void {
  const content = readFileSync(configPath, FILE_SYSTEM.UTF8 as BufferEncoding);
  const workspace = (asRecord(YAML.parse(content)) as WorkspaceDoc | null) ?? {};
  workspace[SOFTWARE_DELIVERY_KEY] = config;
  const nextContent = YAML.stringify(workspace);
  writeFileSync(configPath, nextContent, FILE_SYSTEM.UTF8 as BufferEncoding);
}

// ---------------------------------------------------------------------------
// Build commit message
// ---------------------------------------------------------------------------

function buildCommitMessage(options: LaneEditOptions): string {
  const parts: string[] = [];

  if (options.rename) {
    parts.push(`rename '${options.name}' to '${options.rename}'`);
  }
  if (options.wipLimit !== undefined) {
    parts.push(`set wip_limit=${options.wipLimit} on '${options.rename ?? options.name}'`);
  }
  if (options.addPaths) {
    parts.push(`add path(s) ${options.addPaths.join(', ')} to '${options.rename ?? options.name}'`);
  }
  if (options.removePaths) {
    parts.push(
      `remove path(s) ${options.removePaths.join(', ')} from '${options.rename ?? options.name}'`,
    );
  }
  if (options.description !== undefined) {
    parts.push(`set description on '${options.rename ?? options.name}'`);
  }

  return `${COMMIT_PREFIX} ${parts.join(', ')}`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const userArgs = process.argv.slice(2);
  const options = parseLaneEditArgs(userArgs);

  const projectRoot = findProjectRoot();

  // Step 1: Validate preconditions
  const preconditions = validateLaneEditPreconditions(projectRoot);
  if (!preconditions.ok) {
    die(preconditions.error!);
  }

  console.log(
    `${LOG_PREFIX} Editing lane "${options.name}" via micro-worktree isolation (WU-1854)`,
  );

  // Step 2: Use micro-worktree to make atomic changes
  await withMicroWorktree({
    operation: OPERATION_NAME,
    id: `lane-edit-${Date.now()}`,
    logPrefix: LOG_PREFIX,
    pushOnly: true,
    async execute({ worktreePath }) {
      const configRelPath = WORKSPACE_CONFIG_FILE_NAME;
      const configPath = path.join(worktreePath, configRelPath);

      if (!existsSync(configPath)) {
        die(`${LOG_PREFIX} Config file not found in micro-worktree: ${configRelPath}`);
      }

      // Read current config
      const config = readConfigDoc(configPath);
      const definitions = (config.lanes?.definitions ?? []) as LaneDefinition[];

      // Apply edits
      const editResult = applyLaneEdit(definitions, options);
      if (!editResult.ok) {
        die(editResult.error!);
      }

      // Write updated config
      if (!config.lanes) {
        config.lanes = {};
      }
      config.lanes.definitions = editResult.definitions;
      writeConfigDoc(configPath, config);

      // Run lane:validate on the updated config to surface errors before commit
      const validation = validateLaneArtifacts(worktreePath);
      if (validation.warnings.length > 0 || validation.invalidLanes.length > 0) {
        const issues = [
          ...validation.warnings.map((w) => `  - ${w}`),
          ...validation.invalidLanes.map((l) => `  - Invalid lane: ${l}`),
        ].join('\n');
        die(`${LOG_PREFIX} lane:validate failed after edit. Changes NOT committed.\n${issues}`);
      }

      console.log(`${LOG_PREFIX} lane:validate passed after edit.`);

      return {
        commitMessage: buildCommitMessage(options),
        files: [configRelPath],
      };
    },
  });

  // Step 3: Report success
  const displayName = options.rename ?? options.name;
  console.log(`${LOG_PREFIX} Lane "${displayName}" updated successfully.`);
}

if (import.meta.main) {
  void runCLI(main);
}
