// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { validateBacklogSync } from '@lumenflow/core/backlog-sync-validator';
import { die, getErrorMessage } from '@lumenflow/core/error-handler';
import { resolveWuDonePreCommitGateDecision } from '@lumenflow/core/gates-agent-mode';
import { getGitForCwd } from '@lumenflow/core/git-adapter';
import {
  buildPreflightErrorMessage,
  runPreflightTasksValidation,
  validateAllPreCommitHooks,
} from '@lumenflow/core/wu-done-validators';
import { EMOJI, ENV_VARS, FILE_SYSTEM, LOG_PREFIX } from '@lumenflow/core/wu-constants';
import { WUStateStore } from '@lumenflow/core/wu-state-store';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
import { parseYAML } from '@lumenflow/core/wu-yaml';
import { resolveStateDir } from './state-path-resolvers.js';

interface WUDocLike extends Record<string, unknown> {
  assigned_to?: string | null;
  session_id?: string;
  lane?: string;
  worktree_path?: string;
}

const GIT_CONFIG_USER_EMAIL = 'user.email';

interface OwnershipCheckResult {
  valid: boolean;
  error: string | null;
  auditEntry: Record<string, unknown> | null;
}

interface StagedValidationGateResult {
  fullGatesRanInCurrentRun: boolean;
  skippedByCheckpoint: boolean;
  checkpointId: string | null;
}

interface StagedValidationParams {
  id: string;
  worktreePath: string | null;
  gateResult: StagedValidationGateResult;
  skipGates: boolean;
  runGatesFn: (options: { cwd?: string }) => Promise<boolean>;
}

interface BranchOnlyFallbackInput {
  isBranchOnly: boolean;
  branchOnlyRequested: boolean;
  worktreeExists: boolean;
  derivedWorktree: string | null;
}

export function computeBranchOnlyFallback({
  isBranchOnly,
  branchOnlyRequested,
  worktreeExists,
  derivedWorktree,
}: BranchOnlyFallbackInput) {
  const allowFallback =
    Boolean(branchOnlyRequested) && !isBranchOnly && !worktreeExists && Boolean(derivedWorktree);
  return {
    allowFallback,
    effectiveBranchOnly: isBranchOnly || allowFallback,
  };
}

/**
 * WU-1234: Normalize username for ownership comparison
 * Extracts username from email address for comparison.
 */
export function normalizeUsername(value: string | null | undefined): string {
  if (!value) return '';
  const str = String(value).trim();
  const atIndex = str.indexOf('@');
  const username = atIndex > 0 ? str.slice(0, atIndex) : str;
  return username.toLowerCase();
}

/**
 * WU-1234: Pre-flight check for backlog state consistency.
 */
export function checkBacklogConsistencyForWU(
  id: string,
  backlogPath: string,
): { valid: boolean; error: string | null } {
  try {
    const result = validateBacklogSync(backlogPath);

    if (!result.valid) {
      for (const error of result.errors) {
        if (error.includes('Done and In Progress') && error.includes(id)) {
          return {
            valid: false,
            error:
              `❌ BACKLOG STATE INCONSISTENCY: ${id} found in both Done and In Progress sections.\n\n` +
              `This is an invalid state that must be fixed manually before wu:done can proceed.\n\n` +
              `Fix options:\n` +
              `  1. If ${id} is truly done: Remove from In Progress in backlog.md\n` +
              `  2. If ${id} needs more work: Remove from Done in backlog.md, update WU YAML status\n\n` +
              `After fixing backlog.md, retry: pnpm wu:done --id ${id}`,
          };
        }
      }
    }

    return { valid: true, error: null };
  } catch (e) {
    console.warn(
      `${LOG_PREFIX.DONE} Warning: Could not validate backlog consistency: ${getErrorMessage(e)}`,
    );
    return { valid: true, error: null };
  }
}

export async function appendClaimSessionOverrideAuditEvent({
  wuId,
  claimedSessionId,
  activeSessionId,
  reason,
  worktreePath,
}: {
  wuId: string;
  claimedSessionId: string;
  activeSessionId: string | null;
  reason: string;
  worktreePath: string;
}): Promise<void> {
  const stateDir = resolveStateDir(worktreePath);
  const stateStore = new WUStateStore(stateDir);
  await stateStore.load();
  await stateStore.checkpoint(
    wuId,
    `[wu:done] force ownership override claimed_session=${claimedSessionId} active_session=${activeSessionId || 'none'}`,
    {
      progress: 'wu:done ownership override',
      nextSteps: reason,
    },
  );
}

export async function checkOwnership(
  id: string,
  doc: WUDocLike,
  worktreePath: string | null,
  overrideOwner = false,
  overrideReason: string | null = null,
): Promise<OwnershipCheckResult> {
  if (!worktreePath || !existsSync(worktreePath)) {
    return {
      valid: false,
      error:
        `Missing worktree for ${id}.\n\n` +
        `Expected worktree at: ${worktreePath || 'unknown'}\n\n` +
        `Worktrees are required for proper WU completion in Worktree mode.\n` +
        `If the worktree was removed, recreate it and retry, or use --skip-gates with justification.`,
      auditEntry: null,
    };
  }

  let assignedTo = doc.assigned_to || null;
  if (!assignedTo && worktreePath) {
    const wtWUPath = path.join(worktreePath, WU_PATHS.WU(id));
    if (existsSync(wtWUPath)) {
      try {
        const text = readFileSync(wtWUPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
        const wtDoc = parseYAML(text);
        assignedTo = (wtDoc?.assigned_to as string) || null;
        if (assignedTo) {
          console.log(
            `${LOG_PREFIX.DONE} Note: Read assigned_to from worktree YAML (not found in main)`,
          );
        }
      } catch (err) {
        console.warn(
          `${LOG_PREFIX.DONE} Warning: Failed to read assigned_to from worktree: ${getErrorMessage(err)}`,
        );
      }
    }
  }

  if (!assignedTo) {
    return {
      valid: false,
      error:
        `WU ${id} has no assigned_to field.\n\n` +
        `This WU was claimed before ownership tracking was implemented.\n` +
        `To complete this WU:\n` +
        `  1. Add assigned_to: <your-email> to ${id}.yaml\n` +
        `  2. Commit the change\n` +
        `  3. Re-run: pnpm wu:done --id ${id}`,
      auditEntry: null,
    };
  }

  let currentUser: string | null;
  try {
    currentUser = (await getGitForCwd().getConfigValue(GIT_CONFIG_USER_EMAIL)).trim();
  } catch {
    currentUser = process.env[ENV_VARS.GIT_USER] || process.env[ENV_VARS.USER] || null;
  }

  if (!currentUser) {
    return {
      valid: false,
      error:
        `Cannot determine current user identity.\n\n` +
        `Set git user.email or GIT_USER environment variable.`,
      auditEntry: null,
    };
  }

  const normalizedAssigned = normalizeUsername(assignedTo);
  const normalizedCurrent = normalizeUsername(currentUser);
  const isOwner = normalizedAssigned === normalizedCurrent;

  if (isOwner) {
    if (assignedTo !== currentUser) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.INFO} Ownership match via normalization: "${assignedTo}" == "${currentUser}"`,
      );
    }
    return { valid: true, error: null, auditEntry: null };
  }

  if (overrideOwner) {
    if (!overrideReason) {
      return {
        valid: false,
        error: `--override-owner requires --reason "<why you're completing someone else's WU>"`,
        auditEntry: null,
      };
    }

    const auditEntry = {
      timestamp: new Date().toISOString(),
      wu_id: id,
      assigned_to: assignedTo,
      completed_by: currentUser,
      reason: overrideReason,
      git_commit: (await getGitForCwd().getCommitHash()).trim(),
    };

    console.log(`\n⚠️  --override-owner: Completing WU assigned to someone else`);
    console.log(`   Assigned to: ${assignedTo}`);
    console.log(`   Completed by: ${currentUser}`);
    console.log(`   Reason: ${overrideReason}\n`);

    return { valid: true, error: null, auditEntry };
  }

  return {
    valid: false,
    error:
      `\n❌ OWNERSHIP VIOLATION: ${id} is assigned to someone else\n\n` +
      `   Assigned to: ${assignedTo}\n` +
      `   Current user: ${currentUser}\n\n` +
      `   You cannot complete WUs you do not own.\n\n` +
      `   📋 Options:\n` +
      `      1. Contact ${assignedTo} to complete the WU\n` +
      `      2. Reassign the WU to yourself in ${id}.yaml (requires approval)\n` +
      `      3. Add co_assigned field for pairing (requires approval)\n\n` +
      `   ⚠️  To override (use with extreme caution):\n` +
      `      pnpm wu:done --id ${id} --override-owner --reason "<why>"\n\n` +
      `   AGENTS: NEVER use --override-owner without explicit instruction.\n` +
      `   Language protocol: "pick up WU-${id.replace('WU-', '')}" = READ ONLY.\n`,
    auditEntry: null,
  };
}

export function auditOwnershipOverride(auditEntry: Record<string, unknown>): void {
  const auditPath = path.join('.lumenflow', 'ownership-override-audit.log');
  const auditDir = path.dirname(auditPath);
  if (!existsSync(auditDir)) mkdirSync(auditDir, { recursive: true });
  const line = JSON.stringify(auditEntry);
  appendFileSync(auditPath, `${line}\n`, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding });
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.MEMO} Ownership override logged to ${auditPath}`);
}

export async function runWuDoneStagedValidation({
  id,
  worktreePath,
  gateResult,
  skipGates,
  runGatesFn,
}: StagedValidationParams): Promise<void> {
  const preCommitGateDecision = resolveWuDonePreCommitGateDecision({
    skipGates,
    fullGatesRanInCurrentRun: gateResult.fullGatesRanInCurrentRun,
    skippedByCheckpoint: gateResult.skippedByCheckpoint,
    checkpointId: gateResult.checkpointId,
  });
  console.log(`${LOG_PREFIX.DONE} ${preCommitGateDecision.message}`);

  if (preCommitGateDecision.runPreCommitFullSuite) {
    const hookResult = await validateAllPreCommitHooks(id, worktreePath, {
      runGates: ({ cwd }) => runGatesFn({ cwd }),
    });
    if (!hookResult.valid) {
      die('Pre-flight validation failed. Fix hook issues and try again.');
    }
  }

  const tasksValidationResult = runPreflightTasksValidation(id);
  if (!tasksValidationResult.valid) {
    const errorMessage = buildPreflightErrorMessage(id, tasksValidationResult.errors);
    console.error(errorMessage);
    die('Preflight tasks:validate failed. See errors above for fix options.');
  }
}
