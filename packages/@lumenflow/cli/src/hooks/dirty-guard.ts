// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file dirty-guard.ts
 * Dirty-main mutation guard for wu:prep and wu:done.
 *
 * Single responsibility: evaluate whether a command should be blocked because
 * the main checkout has non-allowlisted dirty files while a worktree WU
 * is active.
 * Split from enforcement-checks.ts (WU-2127).
 */

import { resolveMainWriteAllowlistPrefixes } from './config-resolver.js';
import {
  getNonAllowlistedDirtyPaths,
  formatMainDirtyMutationGuardMessage,
} from './git-status-parser.js';

const DIRTY_MAIN_GUARD_REASONS = {
  BRANCH_PR_MODE: 'branch-pr-mode',
  NO_WORKTREE_CONTEXT: 'no-worktree-context',
  CLEAN_OR_ALLOWLISTED: 'clean-or-allowlisted',
  BLOCKED_NON_ALLOWLISTED_DIRTY_MAIN: 'blocked-non-allowlisted-dirty-main',
} as const;

export interface MainDirtyMutationGuardOptions {
  commandName: string;
  mainCheckout: string;
  mainStatus: string;
  hasActiveWorktreeContext: boolean;
  isBranchPrMode: boolean;
}

export interface MainDirtyMutationGuardResult {
  blocked: boolean;
  blockedPaths: string[];
  reason: string;
  message?: string;
}

export function evaluateMainDirtyMutationGuard(
  options: MainDirtyMutationGuardOptions,
): MainDirtyMutationGuardResult {
  const { commandName, mainCheckout, mainStatus, hasActiveWorktreeContext, isBranchPrMode } =
    options;
  const allowlistPrefixes = resolveMainWriteAllowlistPrefixes(mainCheckout);

  if (isBranchPrMode) {
    return {
      blocked: false,
      blockedPaths: [],
      reason: DIRTY_MAIN_GUARD_REASONS.BRANCH_PR_MODE,
    };
  }

  if (!hasActiveWorktreeContext) {
    return {
      blocked: false,
      blockedPaths: [],
      reason: DIRTY_MAIN_GUARD_REASONS.NO_WORKTREE_CONTEXT,
    };
  }

  const blockedPaths = getNonAllowlistedDirtyPaths(mainStatus, allowlistPrefixes);
  if (blockedPaths.length === 0) {
    return {
      blocked: false,
      blockedPaths: [],
      reason: DIRTY_MAIN_GUARD_REASONS.CLEAN_OR_ALLOWLISTED,
    };
  }

  return {
    blocked: true,
    blockedPaths,
    reason: DIRTY_MAIN_GUARD_REASONS.BLOCKED_NON_ALLOWLISTED_DIRTY_MAIN,
    message: formatMainDirtyMutationGuardMessage({
      commandName,
      mainCheckout,
      blockedPaths,
      allowlistPrefixes,
    }),
  };
}
