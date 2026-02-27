#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * WU Recovery Command
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * Analyzes WU state inconsistencies and offers recovery actions:
 * - resume: Reconcile state and continue working (preserves work)
 * - reset: Discard worktree and reset WU to ready (requires --force)
 * - nuke: Remove all artifacts completely (requires --force)
 * - cleanup: Remove leftover worktree for done WUs
 *
 * Usage:
 *   pnpm wu:recover --id WU-123             # Analyze issues
 *   pnpm wu:recover --id WU-123 --action resume  # Apply fix
 *   pnpm wu:recover --id WU-123 --action nuke --force  # Destructive
 */

import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core/arg-parser';
import { computeContext } from '@lumenflow/core/context/index';
import { analyzeRecovery, type RecoveryAnalysis } from '@lumenflow/core/recovery/recovery-analyzer';
import { die } from '@lumenflow/core/error-handler';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { readWU, writeWU } from '@lumenflow/core/wu-yaml';
import {
  CONTEXT_VALIDATION,
  EMOJI,
  WU_STATUS,
  DEFAULTS,
  toKebab,
  FILE_SYSTEM,
  REMOTES,
  GIT_FLAGS,
  getLaneBranch,
} from '@lumenflow/core/wu-constants';
import { getGitForCwd, createGitForPath } from '@lumenflow/core/git-adapter';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { WUStateStore } from '@lumenflow/core/wu-state-store';
import { generateBacklog, generateStatus } from '@lumenflow/core/backlog-generator';
import { releaseLaneLock } from '@lumenflow/core/lane-lock';
import { join, relative } from 'node:path';
import { resolveStateDir, resolveWuEventsRelativePath } from './state-path-resolvers.js';

const { RECOVERY_ACTIONS } = CONTEXT_VALIDATION;
const LOG_PREFIX = '[wu:recover]';
const OPERATION_NAME = 'wu-recover';

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
 *
 * WU-2238: reset is destructive (deletes remote branch, emits release event)
 * and now requires --force alongside nuke.
 */
export function requiresForceFlag(action: string): boolean {
  return action === RECOVERY_ACTIONS.NUKE || action === RECOVERY_ACTIONS.RESET;
}

/**
 * WU-2238: Get warning message for reset action listing what will be destroyed.
 */
export function getResetWarningMessage(wuId: string): string {
  return [
    `WARNING: --action reset for ${wuId} is destructive and will:`,
    `  - Delete the remote branch (origin/lane/...)`,
    `  - Emit a release event to the state store`,
    `  - Remove the local worktree (if it exists)`,
    `  - Reset WU status to ready and clear all claim metadata`,
    ``,
    `Any unmerged work on the remote branch will be permanently lost.`,
    ``,
    `To proceed, re-run with --force:`,
    `  pnpm wu:recover --id ${wuId} --action reset --force`,
  ].join('\n');
}

/**
 * WU-2238: Get a warning message for any destructive action.
 * Returns empty string for non-destructive actions.
 */
export function getDestructiveActionWarning(action: string, wuId: string): string {
  if (action === RECOVERY_ACTIONS.RESET) {
    return getResetWarningMessage(wuId);
  }
  if (action === RECOVERY_ACTIONS.NUKE) {
    return `Action '${action}' is destructive and requires --force flag for ${wuId}`;
  }
  return '';
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
 * WU-2249: Check if a worktree has uncommitted changes (dirty files).
 *
 * @param worktreePath - Absolute path to the worktree directory
 * @returns Array of dirty file lines (empty if clean or path does not exist)
 */
export async function checkWorktreeForDirtyFiles(worktreePath: string): Promise<string[]> {
  if (!existsSync(worktreePath)) {
    return [];
  }

  try {
    const git = createGitForPath(worktreePath);
    const status = await git.getStatus();
    if (!status) {
      return [];
    }
    return status.split('\n').filter((line: string) => line.trim() !== '');
  } catch {
    // If git status fails (e.g., not a valid git dir), treat as clean
    return [];
  }
}

/**
 * WU-2249: Get an abort message when worktree has uncommitted changes.
 *
 * @param wuId - The WU ID
 * @param dirtyFiles - Array of dirty file lines from git status --porcelain
 * @returns Human-readable abort message with instructions
 */
export function getDirtyWorktreeAbortMessage(wuId: string, dirtyFiles: string[]): string {
  return [
    `ABORT: Worktree for ${wuId} has uncommitted changes:`,
    ``,
    ...dirtyFiles.map((f) => `  ${f}`),
    ``,
    `To preserve your work, commit or stash changes in the worktree first.`,
    `To discard changes and proceed with reset, re-run with --discard-changes:`,
    `  pnpm wu:recover --id ${wuId} --action reset --force --discard-changes`,
  ].join('\n');
}

export function getLaneBranchNameForWU(wuId: string, lane: string): string {
  return getLaneBranch(lane, wuId);
}

/**
 * Remove the lane branch locally and remotely.
 * Used by reset/nuke to clear branch-based coordination locks for re-claim.
 */
export async function deleteLaneBranchArtifacts(wuId: string, lane: string): Promise<void> {
  if (!lane) return;

  const branchName = getLaneBranchNameForWU(wuId, lane);
  const git = getGitForCwd();

  try {
    await git.deleteBranch(branchName, { force: true });
    console.log(`${LOG_PREFIX} Deleted branch: ${branchName}`);
  } catch {
    // Local branch may not exist; continue.
  }

  try {
    await git.raw(['push', REMOTES.ORIGIN, GIT_FLAGS.DELETE_REMOTE, branchName]);
    console.log(`${LOG_PREFIX} Deleted remote branch: ${REMOTES.ORIGIN}/${branchName}`);
  } catch {
    // Remote branch may not exist; continue.
  }
}

/**
 * WU-1595: Reset WU claim metadata when transitioning back to ready.
 *
 * Mutates the provided document.
 */
export function resetClaimMetadataForReady(doc: Record<string, unknown>): void {
  doc.status = WU_STATUS.READY;
  Reflect.deleteProperty(doc, 'worktree_path');
  Reflect.deleteProperty(doc, 'claimed_at');
  Reflect.deleteProperty(doc, 'session_id');
  Reflect.deleteProperty(doc, 'baseline_main_sha');
  Reflect.deleteProperty(doc, 'claimed_mode');
  Reflect.deleteProperty(doc, 'claimed_branch');
}

export function shouldUseBranchPrRecoverPath(doc: { claimed_mode?: string }): boolean {
  return doc.claimed_mode === 'branch-pr';
}

/**
 * Execute resume action - reconcile state and continue
 *
 * WU-1226: Uses micro-worktree isolation for all state changes.
 * Changes are pushed via merge, not direct file modification on main.
 */
async function executeResume(wuId: string): Promise<boolean> {
  console.log(`${LOG_PREFIX} Executing resume action for ${wuId}...`);

  const wuPath = WU_PATHS.WU(wuId);
  if (!existsSync(wuPath)) {
    console.error(`${LOG_PREFIX} ${EMOJI.FAILURE} WU file not found: ${wuPath}`);
    return false;
  }

  const doc = readWU(wuPath, wuId);
  const branchPrPath = shouldUseBranchPrRecoverPath(doc);

  // If status is already in_progress, nothing to do
  if (doc.status !== WU_STATUS.READY) {
    console.log(
      `${LOG_PREFIX} ${EMOJI.SUCCESS} Resume completed - WU already has status '${doc.status}'`,
    );
    return true;
  }

  if (branchPrPath) {
    try {
      const git = getGitForCwd();
      const currentBranch = await git.getCurrentBranch();
      const claimedBranch = typeof doc.claimed_branch === 'string' ? doc.claimed_branch : '';
      if (claimedBranch && claimedBranch !== currentBranch) {
        console.error(
          `${LOG_PREFIX} ${EMOJI.FAILURE} Current branch '${currentBranch}' does not match claimed_branch '${claimedBranch}'`,
        );
        return false;
      }

      doc.status = WU_STATUS.IN_PROGRESS;
      writeWU(wuPath, doc);

      await git.add(WU_PATHS.WU(wuId));
      await git.commit(`fix(wu-recover): resume ${wuId} - set status to in_progress`);
      await git.push('origin', currentBranch);

      console.log(`${LOG_PREFIX} ${EMOJI.SUCCESS} Updated ${wuId} status to in_progress`);
      console.log(
        `${LOG_PREFIX} ${EMOJI.SUCCESS} Resume completed on branch ${currentBranch} - you can continue working`,
      );
      return true;
    } catch (err) {
      console.error(
        `${LOG_PREFIX} ${EMOJI.FAILURE} Branch-pr resume failed: ${(err as Error).message}`,
      );
      return false;
    }
  }

  // WU-1226: Use micro-worktree isolation for state changes
  // WU-2240: Also emit claim event to state store so wu:done succeeds
  try {
    await withMicroWorktree({
      operation: OPERATION_NAME,
      id: wuId,
      logPrefix: LOG_PREFIX,
      pushOnly: true, // Don't modify local main
      execute: async ({ worktreePath }) => {
        // Read WU in micro-worktree context
        const microWuPath = join(worktreePath, relative(process.cwd(), wuPath));
        const microDoc = readWU(microWuPath, wuId);

        // Update status to in_progress
        microDoc.status = WU_STATUS.IN_PROGRESS;
        writeWU(microWuPath, microDoc);

        // WU-2240: Emit corrective claim event to state store
        // Without this, state store still thinks WU is ready, and wu:done
        // fails with "status ready, expected in_progress"
        const stateDir = resolveStateDir(worktreePath);
        const store = new WUStateStore(stateDir);
        await store.load();
        const lane = (microDoc.lane as string) || '';
        const title = (microDoc.title as string) || `WU ${wuId}`;
        await store.claim(wuId, lane, title);
        console.log(`${LOG_PREFIX} Emitted claim event to state store`);

        return {
          commitMessage: `fix(wu-recover): resume ${wuId} - set status to in_progress`,
          files: [relative(process.cwd(), wuPath), resolveWuEventsRelativePath(worktreePath)],
        };
      },
    });

    console.log(`${LOG_PREFIX} ${EMOJI.SUCCESS} Updated ${wuId} status to in_progress`);
    console.log(
      `${LOG_PREFIX} ${EMOJI.SUCCESS} Resume completed - you can continue working in the worktree`,
    );
    return true;
  } catch (err) {
    console.error(
      `${LOG_PREFIX} ${EMOJI.FAILURE} Micro-worktree operation failed: ${(err as Error).message}`,
    );
    return false;
  }
}

/**
 * Execute reset action - discard worktree and reset to ready
 *
 * WU-1226: Uses micro-worktree isolation for WU YAML state changes.
 * WU-1419: Emits release event to state store so WU can be re-claimed.
 * Worktree removal still happens directly (git operation, not file write).
 * Changes are pushed via merge, not direct file modification on main.
 */
async function executeReset(wuId: string, discardChanges = false): Promise<boolean> {
  console.log(`${LOG_PREFIX} Executing reset action for ${wuId}...`);

  const wuPath = WU_PATHS.WU(wuId);
  if (!existsSync(wuPath)) {
    console.error(`${LOG_PREFIX} ${EMOJI.FAILURE} WU file not found: ${wuPath}`);
    return false;
  }

  const doc = readWU(wuPath, wuId);
  const branchPrPath = shouldUseBranchPrRecoverPath(doc);
  const worktreePath = getWorktreePath(wuId, (doc.lane as string) || '');
  const lane = (doc.lane as string) || '';

  // WU-2249: Check worktree for uncommitted changes before deletion
  if (existsSync(worktreePath) && !discardChanges) {
    const dirtyFiles = await checkWorktreeForDirtyFiles(worktreePath);
    if (dirtyFiles.length > 0) {
      console.error(getDirtyWorktreeAbortMessage(wuId, dirtyFiles));
      return false;
    }
  }

  // Remove worktree if exists (git operation, safe to do directly)
  // WU-1097: Use worktreeRemove() instead of deprecated run() with shell strings
  // This properly handles paths with spaces and special characters
  if (existsSync(worktreePath)) {
    try {
      const git = getGitForCwd();
      await git.worktreeRemove(worktreePath, { force: true });
      console.log(`${LOG_PREFIX} Removed worktree: ${worktreePath}`);
    } catch {
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

  // WU-1226/WU-1592: Use micro-worktree for local workflow; branch-pr writes on claimed branch.
  // WU-1419: Also emit release event to state store.
  try {
    if (branchPrPath) {
      const git = getGitForCwd();
      const currentBranch = await git.getCurrentBranch();
      const claimedBranch = typeof doc.claimed_branch === 'string' ? doc.claimed_branch : '';
      if (claimedBranch && claimedBranch !== currentBranch) {
        console.error(
          `${LOG_PREFIX} ${EMOJI.FAILURE} Current branch '${currentBranch}' does not match claimed_branch '${claimedBranch}'`,
        );
        return false;
      }

      resetClaimMetadataForReady(doc);
      writeWU(wuPath, doc);

      const filesToCommit: string[] = [WU_PATHS.WU(wuId)];
      let commitMessage = `fix(wu-recover): reset ${wuId} - clear claim and set status to ready`;

      const stateDir = resolveStateDir(process.cwd());
      const store = new WUStateStore(stateDir);
      await store.load();
      const currentState = store.getWUState(wuId);
      if (currentState && currentState.status === 'in_progress') {
        await store.release(wuId, 'Reset via wu:recover --action reset');
        console.log(`${LOG_PREFIX} Emitted release event to state store`);

        const backlogContent = await generateBacklog(store);
        writeFileSync(WU_PATHS.BACKLOG(), backlogContent, {
          encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
        });

        const statusContent = await generateStatus(store);
        writeFileSync(WU_PATHS.STATUS(), statusContent, {
          encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
        });

        filesToCommit.push(
          WU_PATHS.STATUS(),
          WU_PATHS.BACKLOG(),
          resolveWuEventsRelativePath(process.cwd()),
        );
        commitMessage = `fix(wu-recover): reset ${wuId} - clear claim and emit release event`;
      }

      await git.add(filesToCommit);
      await git.commit(commitMessage);
      await git.push('origin', currentBranch);
    } else {
      await withMicroWorktree({
        operation: OPERATION_NAME,
        id: wuId,
        logPrefix: LOG_PREFIX,
        pushOnly: true, // Don't modify local main
        execute: async ({ worktreePath: microPath }) => {
          // Read WU in micro-worktree context
          const microWuPath = join(microPath, relative(process.cwd(), wuPath));
          const microDoc = readWU(microWuPath, wuId);

          // Reset WU status to ready and clear claim fields.
          resetClaimMetadataForReady(microDoc);
          writeWU(microWuPath, microDoc);

          // WU-1419: Emit release event to state store so re-claiming works
          // Without this, state store still thinks WU is in_progress, blocking re-claim
          const stateDir = resolveStateDir(microPath);
          const store = new WUStateStore(stateDir);
          await store.load();

          // Only emit release event if WU is currently in_progress in state store
          const currentState = store.getWUState(wuId);
          if (currentState && currentState.status === 'in_progress') {
            await store.release(wuId, 'Reset via wu:recover --action reset');
            console.log(`${LOG_PREFIX} Emitted release event to state store`);

            // Regenerate backlog.md and status.md from state store
            const microBacklogPath = join(microPath, WU_PATHS.BACKLOG());
            const microStatusPath = join(microPath, WU_PATHS.STATUS());

            const backlogContent = await generateBacklog(store);
            writeFileSync(microBacklogPath, backlogContent, {
              encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
            });

            const statusContent = await generateStatus(store);
            writeFileSync(microStatusPath, statusContent, {
              encoding: FILE_SYSTEM.UTF8 as BufferEncoding,
            });

            return {
              commitMessage: `fix(wu-recover): reset ${wuId} - clear claim and emit release event`,
              files: [
                relative(process.cwd(), wuPath),
                WU_PATHS.STATUS(),
                WU_PATHS.BACKLOG(),
                resolveWuEventsRelativePath(microPath),
              ],
            };
          }

          // WU not in state store as in_progress, just update YAML
          return {
            commitMessage: `fix(wu-recover): reset ${wuId} - clear claim and set status to ready`,
            files: [relative(process.cwd(), wuPath)],
          };
        },
      });
    }

    // Release lane lock so another WU can be claimed
    if (lane) {
      try {
        const releaseResult = releaseLaneLock(lane, { wuId });
        if (releaseResult.released && !releaseResult.notFound) {
          console.log(`${LOG_PREFIX} Lane lock released for "${lane}"`);
        }
      } catch (err) {
        // Non-blocking: lock release failure should not block the reset operation
        console.warn(
          `${LOG_PREFIX} Warning: Could not release lane lock: ${(err as Error).message}`,
        );
      }
    }

    // WU-1624: Reset should also clear lane branch coordination artifacts.
    // Otherwise wu:claim can still block on stale origin/lane/... branch existence.
    if (!branchPrPath && lane) {
      await deleteLaneBranchArtifacts(wuId, lane);
    }

    console.log(
      `${LOG_PREFIX} ${EMOJI.SUCCESS} Reset completed - ${wuId} is now ready for re-claiming`,
    );
    return true;
  } catch (err) {
    console.error(
      `${LOG_PREFIX} ${EMOJI.FAILURE} Micro-worktree operation failed: ${(err as Error).message}`,
    );
    return false;
  }
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
    const worktreePath = getWorktreePath(wuId, (doc.lane as string) || '');

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

    // WU-1624: Nuke must clear both local and remote branch artifacts.
    await deleteLaneBranchArtifacts(wuId, (doc.lane as string) || '');
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

  const worktreePath = getWorktreePath(wuId, (doc.lane as string) || '');

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
 *
 * WU-1226: All state-modifying actions (resume, reset) now use micro-worktree
 * isolation. Changes are pushed via merge, not direct file modification on main.
 *
 * @param action - Recovery action type
 * @param wuId - WU ID to recover
 * @returns Promise<boolean> - true if action succeeded
 */
export async function executeRecoveryAction(
  action: RecoveryActionType,
  wuId: string,
  options?: { discardChanges?: boolean },
): Promise<boolean> {
  switch (action) {
    case RECOVERY_ACTIONS.RESUME:
      return executeResume(wuId);
    case RECOVERY_ACTIONS.RESET:
      return executeReset(wuId, options?.discardChanges);
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
export async function main(): Promise<void> {
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
        description: 'Required for destructive actions (reset, nuke)',
      },
      {
        name: 'discardChanges',
        flags: '--discard-changes',
        type: 'boolean',
        description: 'Allow reset to proceed even if worktree has uncommitted changes',
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

  const { id, action, force, discardChanges, json } = args as {
    id: string;
    action?: string;
    force?: boolean;
    discardChanges?: boolean;
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

  // WU-2238: Check force flag for destructive actions with detailed warning
  if (requiresForceFlag(action) && !force) {
    const warning = getDestructiveActionWarning(action, id);
    if (warning) {
      console.error(warning);
    }
    die(`Action '${action}' requires --force flag`);
  }

  // Execute action
  const success = await executeRecoveryAction(action as RecoveryActionType, id, {
    discardChanges,
  });

  if (!success) {
    console.error(`${LOG_PREFIX} ${EMOJI.FAILURE} Recovery action failed`);
    process.exit(1);
  }

  process.exit(0);
}

// WU-1181: Use import.meta.main instead of process.argv[1] comparison
// The old pattern fails with pnpm symlinks because process.argv[1] is the symlink
// path but import.meta.url resolves to the real path - they never match
import { runCLI } from './cli-entry-point.js';
if (import.meta.main) {
  void runCLI(main);
}
