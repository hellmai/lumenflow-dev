#!/usr/bin/env node
/**
 * WU Recovery Command
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * Analyzes WU state inconsistencies and offers recovery actions:
 * - resume: Reconcile state and continue working (preserves work)
 * - reset: Discard worktree and reset WU to ready
 * - nuke: Remove all artifacts completely (requires --force)
 * - cleanup: Remove leftover worktree for done WUs
 *
 * Usage:
 *   pnpm wu:recover --id WU-123             # Analyze issues
 *   pnpm wu:recover --id WU-123 --action resume  # Apply fix
 *   pnpm wu:recover --id WU-123 --action nuke --force  # Destructive
 */

import { existsSync, rmSync } from 'node:fs';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/dist/arg-parser.js';
import { computeContext } from '@lumenflow/core/dist/context/index.js';
import {
  analyzeRecovery,
  type RecoveryAnalysis,
} from '@lumenflow/core/dist/recovery/recovery-analyzer.js';
import { die } from '@lumenflow/core/dist/error-handler.js';
import { WU_PATHS } from '@lumenflow/core/dist/wu-paths.js';
import { readWU, writeWU } from '@lumenflow/core/dist/wu-yaml.js';
import {
  CONTEXT_VALIDATION,
  EMOJI,
  WU_STATUS,
  DEFAULTS,
  toKebab,
} from '@lumenflow/core/dist/wu-constants.js';
import { getGitForCwd } from '@lumenflow/core/dist/git-adapter.js';
import { join } from 'node:path';

const { RECOVERY_ACTIONS } = CONTEXT_VALIDATION;
const LOG_PREFIX = '[wu:recover]';

type RecoveryActionType = (typeof RECOVERY_ACTIONS)[keyof typeof RECOVERY_ACTIONS];

/**
 * Valid recovery action types
 */
const VALID_ACTIONS: RecoveryActionType[] = [
  RECOVERY_ACTIONS.RESUME,
  RECOVERY_ACTIONS.RESET,
  RECOVERY_ACTIONS.NUKE,
  RECOVERY_ACTIONS.CLEANUP,
];

/**
 * Check if action requires --force flag
 */
export function requiresForceFlag(action: string): boolean {
  return action === RECOVERY_ACTIONS.NUKE;
}

/**
 * Validate recovery action
 */
export function validateRecoveryAction(action: string): { valid: boolean; error?: string } {
  if (VALID_ACTIONS.includes(action as RecoveryActionType)) {
    return { valid: true };
  }
  return {
    valid: false,
    error: `Invalid action '${action}'. Valid actions: ${VALID_ACTIONS.join(', ')}`,
  };
}

/**
 * Format recovery analysis output
 */
export function formatRecoveryOutput(analysis: RecoveryAnalysis): string {
  const lines: string[] = [];

  lines.push(`## Recovery Analysis for ${analysis.wuId || 'unknown'}`);
  lines.push('');

  if (!analysis.hasIssues) {
    lines.push(`${EMOJI.SUCCESS} No issues found - WU state is healthy`);
    return lines.join('\n');
  }

  // Issues section
  lines.push('### Issues Detected');
  for (const issue of analysis.issues) {
    lines.push(`  ${EMOJI.FAILURE} ${issue.code}: ${issue.description}`);
  }
  lines.push('');

  // Actions section
  if (analysis.actions.length > 0) {
    lines.push('### Available Recovery Actions');
    for (const action of analysis.actions) {
      lines.push(`  **${action.type}**: ${action.description}`);
      lines.push(`    Command: ${action.command}`);
      if (action.warning) {
        lines.push(`    ${EMOJI.WARNING} Warning: ${action.warning}`);
      }
      if (action.requiresForce) {
        lines.push(`    Requires: --force flag`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Get exit code for recovery command
 */
export function getRecoveryExitCode(analysis: RecoveryAnalysis, actionFailed: boolean): number {
  if (actionFailed) {
    return 1;
  }
  return 0;
}

/**
 * Get expected worktree path for a WU
 */
function getWorktreePath(wuId: string, lane: string): string {
  const laneKebab = toKebab(lane);
  const wuIdLower = wuId.toLowerCase();
  return join(process.cwd(), DEFAULTS.WORKTREES_DIR, `${laneKebab}-${wuIdLower}`);
}

/**
 * Execute resume action - reconcile state and continue
 */
async function executeResume(wuId: string): Promise<boolean> {
  console.log(`${LOG_PREFIX} Executing resume action for ${wuId}...`);

  const wuPath = WU_PATHS.WU(wuId);
  if (!existsSync(wuPath)) {
    console.error(`${LOG_PREFIX} ${EMOJI.FAILURE} WU file not found: ${wuPath}`);
    return false;
  }

  const doc = readWU(wuPath, wuId);

  // Update status to in_progress if it was ready
  if (doc.status === WU_STATUS.READY) {
    doc.status = WU_STATUS.IN_PROGRESS;
    writeWU(wuPath, doc);
    console.log(`${LOG_PREFIX} ${EMOJI.SUCCESS} Updated ${wuId} status to in_progress`);
  }

  console.log(
    `${LOG_PREFIX} ${EMOJI.SUCCESS} Resume completed - you can continue working in the worktree`,
  );
  return true;
}

/**
 * Execute reset action - discard worktree and reset to ready
 */
async function executeReset(wuId: string): Promise<boolean> {
  console.log(`${LOG_PREFIX} Executing reset action for ${wuId}...`);

  const wuPath = WU_PATHS.WU(wuId);
  if (!existsSync(wuPath)) {
    console.error(`${LOG_PREFIX} ${EMOJI.FAILURE} WU file not found: ${wuPath}`);
    return false;
  }

  const doc = readWU(wuPath, wuId);
  const worktreePath = getWorktreePath(wuId, doc.lane || '');

  // Remove worktree if exists
  // WU-1097: Use worktreeRemove() instead of deprecated run() with shell strings
  // This properly handles paths with spaces and special characters
  if (existsSync(worktreePath)) {
    try {
      const git = getGitForCwd();
      await git.worktreeRemove(worktreePath, { force: true });
      console.log(`${LOG_PREFIX} Removed worktree: ${worktreePath}`);
    } catch (e) {
      // Try manual removal if git command fails
      try {
        rmSync(worktreePath, { recursive: true, force: true });
        console.log(`${LOG_PREFIX} Manually removed worktree directory: ${worktreePath}`);
      } catch (rmError) {
        console.error(
          `${LOG_PREFIX} ${EMOJI.FAILURE} Failed to remove worktree: ${(rmError as Error).message}`,
        );
        return false;
      }
    }
  }

  // Reset WU status to ready
  doc.status = WU_STATUS.READY;
  delete doc.worktree_path;
  delete doc.claimed_at;
  delete doc.session_id;
  writeWU(wuPath, doc);

  console.log(
    `${LOG_PREFIX} ${EMOJI.SUCCESS} Reset completed - ${wuId} is now ready for re-claiming`,
  );
  return true;
}

/**
 * Execute nuke action - remove all artifacts completely
 */
async function executeNuke(wuId: string): Promise<boolean> {
  console.log(`${LOG_PREFIX} Executing nuke action for ${wuId}...`);

  const wuPath = WU_PATHS.WU(wuId);
  if (!existsSync(wuPath)) {
    console.log(`${LOG_PREFIX} WU file does not exist: ${wuPath}`);
  } else {
    const doc = readWU(wuPath, wuId);
    const worktreePath = getWorktreePath(wuId, doc.lane || '');

    // Remove worktree if exists
    // WU-1097: Use worktreeRemove() instead of deprecated run() with shell strings
    if (existsSync(worktreePath)) {
      try {
        const git = getGitForCwd();
        await git.worktreeRemove(worktreePath, { force: true });
      } catch {
        rmSync(worktreePath, { recursive: true, force: true });
      }
      console.log(`${LOG_PREFIX} Removed worktree: ${worktreePath}`);
    }

    // Try to delete branch
    // WU-1097: Use deleteBranch() instead of deprecated run() with shell strings
    try {
      const git = getGitForCwd();
      const laneKebab = toKebab(doc.lane || '');
      const branchName = `lane/${laneKebab}/${wuId.toLowerCase()}`;
      await git.deleteBranch(branchName, { force: true });
      console.log(`${LOG_PREFIX} Deleted branch: ${branchName}`);
    } catch {
      // Branch may not exist, that's fine
    }
  }

  console.log(`${LOG_PREFIX} ${EMOJI.SUCCESS} Nuke completed - all artifacts removed for ${wuId}`);
  return true;
}

/**
 * Execute cleanup action - remove leftover worktree for done WUs
 */
async function executeCleanup(wuId: string): Promise<boolean> {
  console.log(`${LOG_PREFIX} Executing cleanup action for ${wuId}...`);

  const wuPath = WU_PATHS.WU(wuId);
  if (!existsSync(wuPath)) {
    console.error(`${LOG_PREFIX} ${EMOJI.FAILURE} WU file not found: ${wuPath}`);
    return false;
  }

  const doc = readWU(wuPath, wuId);

  if (doc.status !== WU_STATUS.DONE) {
    console.error(
      `${LOG_PREFIX} ${EMOJI.FAILURE} Cannot cleanup: WU status is '${doc.status}', expected 'done'`,
    );
    return false;
  }

  const worktreePath = getWorktreePath(wuId, doc.lane || '');

  if (!existsSync(worktreePath)) {
    console.log(`${LOG_PREFIX} Worktree does not exist, nothing to cleanup`);
    return true;
  }

  // WU-1097: Use worktreeRemove() instead of deprecated run() with shell strings
  try {
    const git = getGitForCwd();
    await git.worktreeRemove(worktreePath, { force: true });
    console.log(`${LOG_PREFIX} ${EMOJI.SUCCESS} Removed leftover worktree: ${worktreePath}`);
  } catch (e) {
    rmSync(worktreePath, { recursive: true, force: true });
    console.log(
      `${LOG_PREFIX} ${EMOJI.SUCCESS} Manually removed leftover worktree: ${worktreePath}`,
    );
  }

  return true;
}

/**
 * Execute recovery action
 */
async function executeAction(action: RecoveryActionType, wuId: string): Promise<boolean> {
  switch (action) {
    case RECOVERY_ACTIONS.RESUME:
      return executeResume(wuId);
    case RECOVERY_ACTIONS.RESET:
      return executeReset(wuId);
    case RECOVERY_ACTIONS.NUKE:
      return executeNuke(wuId);
    case RECOVERY_ACTIONS.CLEANUP:
      return executeCleanup(wuId);
    default:
      console.error(`${LOG_PREFIX} ${EMOJI.FAILURE} Unknown action: ${action}`);
      return false;
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = createWUParser({
    name: 'wu-recover',
    description: 'Analyze and fix WU state inconsistencies (WU-1090)',
    options: [
      WU_OPTIONS.id,
      {
        name: 'action',
        flags: '-a, --action <action>',
        type: 'string',
        description: 'Recovery action: resume, reset, nuke, cleanup',
      },
      {
        name: 'force',
        flags: '-f, --force',
        type: 'boolean',
        description: 'Required for destructive actions (nuke)',
      },
      {
        name: 'json',
        flags: '-j, --json',
        type: 'boolean',
        description: 'Output as JSON',
      },
    ],
    required: ['id'],
    allowPositionalId: true,
  });

  const { id, action, force, json } = args as {
    id: string;
    action?: string;
    force?: boolean;
    json?: boolean;
  };

  // Compute context for the WU
  const { context } = await computeContext({ wuId: id });

  // Analyze recovery issues
  const analysis = await analyzeRecovery(context);

  // If no action specified, just show analysis
  if (!action) {
    if (json) {
      console.log(JSON.stringify(analysis, null, 2));
    } else {
      console.log(formatRecoveryOutput(analysis));
    }
    process.exit(getRecoveryExitCode(analysis, false));
    return;
  }

  // Validate action
  const validation = validateRecoveryAction(action);
  if (!validation.valid) {
    die(validation.error!);
  }

  // Check force flag for destructive actions
  if (requiresForceFlag(action) && !force) {
    die(`Action '${action}' requires --force flag`);
  }

  // Execute action
  const success = await executeAction(action as RecoveryActionType, id);

  if (!success) {
    console.error(`${LOG_PREFIX} ${EMOJI.FAILURE} Recovery action failed`);
    process.exit(1);
  }

  process.exit(0);
}

// Guard main() for testability
import { fileURLToPath } from 'node:url';
import { runCLI } from './cli-entry-point.js';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCLI(main);
}
