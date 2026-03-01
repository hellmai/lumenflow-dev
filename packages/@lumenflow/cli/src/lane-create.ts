#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file lane-create.ts
 * WU-2258: Add lane:create command for adding new lanes via tooling
 *
 * Creates a new lane definition in workspace.yaml using micro-worktree
 * isolation so local main remains clean while changes are committed safely.
 */

import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import YAML from 'yaml';
import { findProjectRoot, WORKSPACE_CONFIG_FILE_NAME } from '@lumenflow/core/config';
import { WORKSPACE_V2_KEYS } from '@lumenflow/core/config-schema';
import { isValidLaneFormat } from '@lumenflow/core/lane-suggest-prompt';
import { createError, ErrorCodes, die } from '@lumenflow/core/error-handler';
import { FILE_SYSTEM } from '@lumenflow/core/wu-constants';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { runCLI } from './cli-entry-point.js';
import { asRecord } from './object-guards.js';
import {
  validateLaneArtifacts,
  classifyLaneLifecycleForProject,
  LANE_LIFECYCLE_STATUS,
} from './lane-lifecycle-process.js';

const LOG_PREFIX = '[lane:create]';
const OPERATION_NAME = 'lane-create';
const SOFTWARE_DELIVERY_KEY = WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY;

const ARG_NAME = '--name';
const ARG_WIP_LIMIT = '--wip-limit';
const ARG_ADD_PATH = '--add-path';
const ARG_DESCRIPTION = '--description';
const ARG_HELP = '--help';

const COMMIT_PREFIX = 'chore: lane:create';

export interface LaneDefinition {
  name: string;
  wip_limit?: number;
  code_paths?: string[];
  description?: string;
  wip_justification?: string;
  lock_policy?: string;
  [key: string]: unknown;
}

export interface LaneCreateOptions {
  name: string;
  wipLimit: number;
  addPaths?: string[];
  description?: string;
}

interface LaneCreateResult {
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

interface LaneNameValidationResult {
  valid: boolean;
  error?: string;
}

const HELP_TEXT = `Usage: pnpm lane:create --name <lane> [options]

Create a new lane definition in workspace.yaml via micro-worktree commit.

Required:
  ${ARG_NAME} <name>          New lane name ("Parent: Sublane")

Optional:
  ${ARG_WIP_LIMIT} <n>        WIP limit (positive integer, default: 1)
  ${ARG_ADD_PATH} <path>      Add a code path (repeatable)
  ${ARG_DESCRIPTION} <text>   Lane description

Examples:
  pnpm lane:create --name 'Framework: Kernel' --wip-limit 2 --add-path 'packages/@lumenflow/kernel/**'
  pnpm lane:create --name 'Operations: Security' --description 'Security-focused operational work'
`;

export function parseLaneCreateArgs(argv: string[]): LaneCreateOptions {
  if (argv.includes(ARG_HELP)) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  let name: string | undefined;
  let wipLimit = 1;
  const addPaths: string[] = [];
  let description: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case ARG_NAME:
        name = next;
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

  return {
    name,
    wipLimit,
    addPaths: addPaths.length > 0 ? addPaths : undefined,
    description,
  };
}

export function validateLaneCreatePreconditions(projectRoot: string): PreconditionResult {
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
        `lane:create requires lanes to be in locked or draft status. ` +
        `Run: pnpm lane:setup && pnpm lane:lock`,
    };
  }

  return { ok: true };
}

export function validateLaneCreateName(
  name: string,
  _projectRoot: string,
): LaneNameValidationResult {
  if (!isValidLaneFormat(name)) {
    return {
      valid: false,
      error: `${LOG_PREFIX} Invalid lane format: "${name}". Expected "Parent: Sublane".`,
    };
  }
  return { valid: true };
}

export function applyLaneCreate(
  definitions: LaneDefinition[],
  options: LaneCreateOptions,
): LaneCreateResult {
  const { name, wipLimit, addPaths, description } = options;

  const duplicate = definitions.some((lane) => lane.name === name);
  if (duplicate) {
    return {
      ok: false,
      error: `${LOG_PREFIX} Lane "${name}" already exists.`,
    };
  }

  const created: LaneDefinition = {
    name,
    wip_limit: wipLimit,
    code_paths: addPaths ?? [],
  };

  if (description !== undefined) {
    created.description = description;
  }

  const updated = [...definitions, created];
  updated.sort((a, b) => a.name.localeCompare(b.name));

  return { ok: true, definitions: updated };
}

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

function buildCommitMessage(options: LaneCreateOptions): string {
  return `${COMMIT_PREFIX} add lane '${options.name}' (wip_limit=${options.wipLimit})`;
}

async function main(): Promise<void> {
  const userArgs = process.argv.slice(2);
  const options = parseLaneCreateArgs(userArgs);
  const projectRoot = findProjectRoot();

  const preconditions = validateLaneCreatePreconditions(projectRoot);
  if (!preconditions.ok) {
    die(preconditions.error!);
  }

  const laneNameValidation = validateLaneCreateName(options.name, projectRoot);
  if (!laneNameValidation.valid) {
    die(laneNameValidation.error!);
  }

  console.log(`${LOG_PREFIX} Creating lane "${options.name}" via micro-worktree isolation`);

  await withMicroWorktree({
    operation: OPERATION_NAME,
    id: `lane-create-${Date.now()}`,
    logPrefix: LOG_PREFIX,
    pushOnly: true,
    async execute({ worktreePath }) {
      const configRelPath = WORKSPACE_CONFIG_FILE_NAME;
      const configPath = path.join(worktreePath, configRelPath);

      if (!existsSync(configPath)) {
        die(`${LOG_PREFIX} Config file not found in micro-worktree: ${configRelPath}`);
      }

      const nameValidationInWorktree = validateLaneCreateName(options.name, worktreePath);
      if (!nameValidationInWorktree.valid) {
        die(nameValidationInWorktree.error!);
      }

      const config = readConfigDoc(configPath);
      const definitions = (config.lanes?.definitions ?? []) as LaneDefinition[];
      const createResult = applyLaneCreate(definitions, options);

      if (!createResult.ok) {
        die(createResult.error!);
      }

      if (!config.lanes) {
        config.lanes = {};
      }
      config.lanes.definitions = createResult.definitions;
      writeConfigDoc(configPath, config);

      const validation = validateLaneArtifacts(worktreePath);
      if (validation.warnings.length > 0 || validation.invalidLanes.length > 0) {
        const issues = [
          ...validation.warnings.map((warning) => `  - ${warning}`),
          ...validation.invalidLanes.map((lane) => `  - Invalid lane: ${lane}`),
        ].join('\n');
        die(`${LOG_PREFIX} lane:validate failed after create. Changes NOT committed.\n${issues}`);
      }

      console.log(`${LOG_PREFIX} lane:validate passed after create.`);

      return {
        commitMessage: buildCommitMessage(options),
        files: [configRelPath],
      };
    },
  });

  console.log(`${LOG_PREFIX} Lane "${options.name}" created successfully.`);
}

if (import.meta.main) {
  void runCLI(main);
}
