#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file lane-validate.ts
 * WU-2257: Lane validate with micro-worktree isolation and --help support
 *
 * Validates lane artifacts and sets lifecycle status to "draft" via
 * micro-worktree isolation. Previously wrote directly to the current
 * checkout.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { findProjectRoot, WORKSPACE_CONFIG_FILE_NAME } from '@lumenflow/core/config';
import { die } from '@lumenflow/core/error-handler';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import {
  LANE_LIFECYCLE_STATUS,
  recommendLaneLifecycleNextStep,
  setLaneLifecycleStatus,
  validateLaneArtifacts,
} from './lane-lifecycle-process.js';
import { runCLI } from './cli-entry-point.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[lane:validate]';
const PASS_SENTINEL = 'Lane lifecycle validation passed.';
const ARG_HELP = '--help';

export const LANE_VALIDATE_OPERATION_NAME = 'lane-validate';

export const LANE_VALIDATE_HELP_TEXT = `Usage: pnpm lane:validate

Validate lane artifacts before locking.

Checks lane definitions in workspace.yaml,
then sets lane lifecycle status to "draft" via micro-worktree isolation
(changes committed atomically to main).

Prerequisites:
  - workspace.yaml must exist (run \`pnpm workspace-init --yes\` first)
  - Lane artifacts must be created (run \`pnpm lane:setup\` first)

Options:
  ${ARG_HELP}    Show this help text and exit
`;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export function parseLaneValidateArgs(argv: string[]): { help: boolean } {
  return { help: argv.includes(ARG_HELP) };
}

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------

function ensureLumenflowInit(projectRoot: string): void {
  const configPath = path.join(projectRoot, WORKSPACE_CONFIG_FILE_NAME);
  if (!existsSync(configPath)) {
    die(
      `${LOG_PREFIX} Missing ${WORKSPACE_CONFIG_FILE_NAME}.\n\n` +
        'Run `pnpm workspace-init --yes` first, then configure lane lifecycle.',
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const userArgs = process.argv.slice(2);
  const { help } = parseLaneValidateArgs(userArgs);

  if (help) {
    console.log(LANE_VALIDATE_HELP_TEXT);
    return;
  }

  const projectRoot = findProjectRoot();
  ensureLumenflowInit(projectRoot);

  const validation = validateLaneArtifacts(projectRoot);
  const passed = validation.warnings.length === 0 && validation.invalidLanes.length === 0;

  if (!passed) {
    console.log(`${LOG_PREFIX} Validation failed:`);
    for (const warning of validation.warnings) {
      console.log(`  - ${warning}`);
    }
    for (const invalidLane of validation.invalidLanes) {
      console.log(`  - Invalid lane mapping: ${invalidLane}`);
    }
    console.log(
      `${LOG_PREFIX} Next step: ${recommendLaneLifecycleNextStep(LANE_LIFECYCLE_STATUS.UNCONFIGURED)}`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `${LOG_PREFIX} Setting lifecycle status to draft via micro-worktree isolation (WU-2257)`,
  );

  // WU-2257: Use micro-worktree to set lifecycle status atomically
  await withMicroWorktree({
    operation: LANE_VALIDATE_OPERATION_NAME,
    id: `lane-validate-${Date.now()}`,
    logPrefix: LOG_PREFIX,
    pushOnly: true,
    async execute({ worktreePath }) {
      setLaneLifecycleStatus(worktreePath, LANE_LIFECYCLE_STATUS.DRAFT);

      return {
        commitMessage: `chore: lane:validate set lifecycle status to ${LANE_LIFECYCLE_STATUS.DRAFT}`,
        files: [WORKSPACE_CONFIG_FILE_NAME],
      };
    },
  });

  console.log(`${LOG_PREFIX} ${PASS_SENTINEL}`);
  console.log(`${LOG_PREFIX} Lane lifecycle status: ${LANE_LIFECYCLE_STATUS.DRAFT}`);
  console.log(
    `${LOG_PREFIX} Next step: ${recommendLaneLifecycleNextStep(LANE_LIFECYCLE_STATUS.DRAFT)}`,
  );
}

if (import.meta.main) {
  void runCLI(main);
}
