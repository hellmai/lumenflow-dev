#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file lane-setup.ts
 * WU-2257: Lane setup with micro-worktree isolation and --help support
 *
 * Creates/updates draft lane artifacts via micro-worktree isolation.
 * Previously wrote directly to the current checkout.
 * The --lock flag combines setup + validate + lock atomically.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { findProjectRoot, WORKSPACE_CONFIG_FILE_NAME } from '@lumenflow/core/config';
import { die } from '@lumenflow/core/error-handler';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import {
  ensureDraftLaneArtifacts,
  LANE_LIFECYCLE_STATUS,
  recommendLaneLifecycleNextStep,
  validateLaneArtifacts,
  setLaneLifecycleStatus,
} from './lane-lifecycle-process.js';
import { runCLI } from './cli-entry-point.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_PREFIX = '[lane:setup]';
const LANE_VALIDATE_COMMAND = 'pnpm lane:validate';
const ARG_HELP = '--help';
const ARG_LOCK = '--lock';

export const LANE_SETUP_OPERATION_NAME = 'lane-setup';

export const LANE_SETUP_HELP_TEXT = `Usage: pnpm lane:setup [options]

Create or update draft lane artifacts.

Detects workspace structure, creates lane definitions in workspace.yaml
and commits them atomically via micro-worktree isolation.

Options:
  ${ARG_LOCK}    Combine setup + validate + lock into a single command
  ${ARG_HELP}    Show this help text and exit

Examples:
  pnpm lane:setup              # Create draft lane artifacts
  pnpm lane:setup --lock       # Setup, validate, and lock in one step
`;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

export function parseLaneSetupArgs(argv: string[]): { help: boolean; lock: boolean } {
  return {
    help: argv.includes(ARG_HELP),
    lock: argv.includes(ARG_LOCK),
  };
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
  const { help, lock: lockFlag } = parseLaneSetupArgs(userArgs);

  if (help) {
    console.log(LANE_SETUP_HELP_TEXT);
    return;
  }

  const projectRoot = findProjectRoot();
  ensureLumenflowInit(projectRoot);

  console.log(`${LOG_PREFIX} Setting up lane artifacts via micro-worktree isolation (WU-2257)`);

  // WU-2257: Use micro-worktree for all file writes
  await withMicroWorktree({
    operation: LANE_SETUP_OPERATION_NAME,
    id: `lane-setup-${Date.now()}`,
    logPrefix: LOG_PREFIX,
    pushOnly: true,
    async execute({ worktreePath }) {
      const result = ensureDraftLaneArtifacts(worktreePath);

      console.log(`${LOG_PREFIX} Lane lifecycle status: ${result.status}`);

      if (result.createdDefinitions) {
        console.log(`${LOG_PREFIX} Draft artifacts prepared:`);
        console.log(
          `  - ${WORKSPACE_CONFIG_FILE_NAME}: ${result.createdDefinitions ? 'created/updated lane definitions' : 'existing definitions preserved'}`,
        );
      } else {
        console.log(
          `${LOG_PREFIX} Existing lane artifacts preserved. You can expand/edit lanes safely.`,
        );
      }

      // Collect files that were modified
      const files: string[] = [WORKSPACE_CONFIG_FILE_NAME];

      // WU-1755: --lock combines setup + validate + lock into a single command
      if (lockFlag) {
        const validation = validateLaneArtifacts(worktreePath);
        if (validation.warnings.length > 0) {
          for (const warning of validation.warnings) {
            console.warn(`${LOG_PREFIX} Warning: ${warning}`);
          }
        }
        if (validation.missingDefinitions) {
          die(`${LOG_PREFIX} Cannot lock: lane artifacts are incomplete. Fix warnings above.`);
        }
        setLaneLifecycleStatus(worktreePath, LANE_LIFECYCLE_STATUS.LOCKED);
        console.log(`${LOG_PREFIX} Lane lifecycle locked. Ready for WU creation.`);

        return {
          commitMessage: `chore: lane:setup --lock set lifecycle status to ${LANE_LIFECYCLE_STATUS.LOCKED}`,
          files,
        };
      }

      return {
        commitMessage: `chore: lane:setup created draft lane artifacts`,
        files,
      };
    },
  });

  if (!lockFlag) {
    const nextStep = recommendLaneLifecycleNextStep(LANE_LIFECYCLE_STATUS.DRAFT);
    console.log(`${LOG_PREFIX} Validate draft: ${LANE_VALIDATE_COMMAND}`);
    console.log(`${LOG_PREFIX} Lock lifecycle: ${nextStep}`);
  }
}

if (import.meta.main) {
  void runCLI(main);
}
