// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file enforcement-checks.ts
 * Runtime enforcement checks for LumenFlow workflow compliance (WU-1367)
 * WU-1501: Fail-closed default on main - block writes when no active claim context
 * WU-2127: Split into focused sub-modules. This file re-exports the public API
 * and contains the top-level worktree/WU enforcement checks that compose the
 * sub-modules.
 *
 * Sub-modules:
 * - path-utils.ts: Path normalization and allowlist utilities
 * - config-resolver.ts: Configuration-driven path resolution
 * - git-status-parser.ts: Parse and filter dirty paths from git status output
 * - dirty-guard.ts: Dirty-main mutation guard for wu:prep/wu:done
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveWorktreesDirSegment, resolveMainWriteAllowlistPrefixes } from './config-resolver.js';
import { isAllowlistedPath } from './path-utils.js';

// Re-export sub-module public APIs for backward compatibility
export { normalizeDirectorySegment, ensureRepoRelativePrefix, isAllowlistedPath } from './path-utils.js';
export { resolveWorktreesDirSegment, resolveWuAllowlistPrefix, resolveMainWriteAllowlistPrefixes } from './config-resolver.js';
export {
  parseDirtyPathsFromStatus,
  getNonAllowlistedDirtyPaths,
  formatBlockedPaths,
  formatMainDirtyMutationGuardMessage,
} from './git-status-parser.js';
export type { MainDirtyMutationGuardOptions, MainDirtyMutationGuardResult } from './dirty-guard.js';
export { evaluateMainDirtyMutationGuard } from './dirty-guard.js';

/**
 * Result of an enforcement check
 */
export interface EnforcementCheckResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** Reason for the decision */
  reason: string;
  /** Suggested action if blocked */
  suggestion?: string;
}

/**
 * Tool input for Write/Edit operations
 */
export interface ToolInput {
  file_path: string;
  tool_name: string;
}

/**
 * WU-1501: Check if there is an active branch-pr claimed WU in the state file.
 *
 * Branch-PR WUs work on the lane branch from the main checkout without a worktree.
 * When a branch-pr WU is in_progress, writes from main are allowed.
 *
 * @param mainRepoPath - Absolute path to the main repo root
 * @returns True if a branch-pr WU is actively claimed
 */
function hasBranchPrClaim(mainRepoPath: string): boolean {
  const stateFile = path.join(mainRepoPath, '.lumenflow', 'state', 'wu-events.jsonl');

  if (!fs.existsSync(stateFile)) {
    return false;
  }

  try {
    const content = fs.readFileSync(stateFile, 'utf-8');
    return (
      content.includes('"claimed_mode":"branch-pr"') && content.includes('"status":"in_progress"')
    );
  } catch {
    return false;
  }
}

/**
 * Check if a Write/Edit operation should be allowed based on worktree enforcement.
 *
 * WU-1501: Fail-closed on main. When LumenFlow is configured, writes on main
 * are blocked unless:
 * - The path is in the allowlist (WU specs, .lumenflow/, .claude/, plan/)
 * - A branch-pr WU is actively claimed
 * - An active worktree exists (original behavior)
 *
 * Graceful degradation still applies when LumenFlow is NOT configured.
 *
 * @param input - Tool input with file_path and tool_name
 * @param projectDir - Project directory (defaults to CLAUDE_PROJECT_DIR)
 * @returns Check result with allowed status and reason
 */
export async function checkWorktreeEnforcement(
  input: ToolInput,
  projectDir?: string,
): Promise<EnforcementCheckResult> {
  const mainRepoPath = projectDir ?? process.env.CLAUDE_PROJECT_DIR;

  // Graceful degradation: no project dir
  if (!mainRepoPath) {
    return {
      allowed: true,
      reason: 'graceful: CLAUDE_PROJECT_DIR not set',
    };
  }

  const lumenflowDir = path.join(mainRepoPath, '.lumenflow');
  const worktreesDirSegment = resolveWorktreesDirSegment(mainRepoPath);
  const worktreesDir = path.join(mainRepoPath, worktreesDirSegment);

  // Graceful degradation: LumenFlow not configured
  if (!fs.existsSync(lumenflowDir)) {
    return {
      allowed: true,
      reason: 'graceful: LumenFlow not configured',
    };
  }

  // Resolve the file path
  let resolvedPath: string;
  try {
    resolvedPath = path.resolve(input.file_path);
  } catch {
    return {
      allowed: true,
      reason: 'graceful: cannot resolve file path',
    };
  }

  // Path is outside repo entirely - allow
  if (!resolvedPath.startsWith(mainRepoPath + path.sep) && resolvedPath !== mainRepoPath) {
    return {
      allowed: true,
      reason: 'path is outside repository',
    };
  }

  // Allow if path is inside a worktree
  if (resolvedPath.startsWith(worktreesDir + path.sep)) {
    return {
      allowed: true,
      reason: 'path is inside worktree',
    };
  }

  // Check for active worktrees - if they exist, original block logic applies
  let hasActiveWorktrees = false;
  if (fs.existsSync(worktreesDir)) {
    try {
      const entries = fs.readdirSync(worktreesDir);
      const worktreeCount = entries.filter((e) => {
        const stat = fs.statSync(path.join(worktreesDir, e));
        return stat.isDirectory();
      }).length;
      hasActiveWorktrees = worktreeCount > 0;
    } catch {
      // Cannot read worktrees - continue to fail-closed checks
    }
  }

  // If active worktrees exist, block writes to main repo (original behavior)
  if (hasActiveWorktrees) {
    const activeWorktrees = fs
      .readdirSync(worktreesDir)
      .filter((e) => fs.statSync(path.join(worktreesDir, e)).isDirectory())
      .slice(0, 5)
      .join(', ');

    return {
      allowed: false,
      reason: `cannot write to main repo while worktrees exist (${activeWorktrees})`,
      suggestion: `cd to your worktree: cd ${worktreesDirSegment}/<lane>-wu-<id>/`,
    };
  }

  // WU-1501: No active worktrees - fail-closed on main
  // Check allowlist first (always permitted regardless of claim state)
  const allowlistPrefixes = resolveMainWriteAllowlistPrefixes(mainRepoPath);
  if (isAllowlistedPath(resolvedPath, mainRepoPath, allowlistPrefixes)) {
    return {
      allowed: true,
      reason: 'allowlist: path is in safe scaffold/state area',
    };
  }

  // Check for branch-pr claimed_mode (allows main writes)
  if (hasBranchPrClaim(mainRepoPath)) {
    return {
      allowed: true,
      reason: 'branch-pr: active branch-pr WU permits main writes',
    };
  }

  // WU-1501: Fail-closed - no active claim context, block the write
  return {
    allowed: false,
    reason: 'no active claim context on main (fail-closed)',
    suggestion:
      'Claim a WU first: pnpm wu:claim --id WU-XXXX --lane <Lane>\n' +
      'Or use --cloud for branch-pr mode: pnpm wu:claim --id WU-XXXX --lane <Lane> --cloud',
  };
}

/**
 * Check if a Write/Edit operation should be allowed based on WU requirement.
 *
 * @param input - Tool input with file_path and tool_name
 * @param projectDir - Project directory
 * @returns Check result with allowed status and reason
 */
export async function checkWuRequirement(
  input: ToolInput,
  projectDir?: string,
): Promise<EnforcementCheckResult> {
  void input;
  const mainRepoPath = projectDir ?? process.env.CLAUDE_PROJECT_DIR;

  if (!mainRepoPath) {
    return {
      allowed: true,
      reason: 'graceful: CLAUDE_PROJECT_DIR not set',
    };
  }

  const lumenflowDir = path.join(mainRepoPath, '.lumenflow');
  const worktreesDir = path.join(mainRepoPath, resolveWorktreesDirSegment(mainRepoPath));
  const stateFile = path.join(lumenflowDir, 'state', 'wu-events.jsonl');

  // Graceful degradation: LumenFlow not configured
  if (!fs.existsSync(lumenflowDir)) {
    return {
      allowed: true,
      reason: 'graceful: LumenFlow not configured',
    };
  }

  // Check for active worktrees (indicates claimed WU)
  if (fs.existsSync(worktreesDir)) {
    try {
      const entries = fs.readdirSync(worktreesDir);
      const worktreeCount = entries.filter((e) => {
        const stat = fs.statSync(path.join(worktreesDir, e));
        return stat.isDirectory();
      }).length;

      if (worktreeCount > 0) {
        return {
          allowed: true,
          reason: 'has active worktree (claimed WU)',
        };
      }
    } catch {
      // Continue to state file check
    }
  }

  // Check state file for in_progress WUs
  if (fs.existsSync(stateFile)) {
    try {
      const content = fs.readFileSync(stateFile, 'utf-8');
      if (content.includes('"status":"in_progress"')) {
        return {
          allowed: true,
          reason: 'has in_progress WU in state',
        };
      }
    } catch {
      return {
        allowed: true,
        reason: 'graceful: cannot read state file',
      };
    }
  }

  // No claimed WU found
  return {
    allowed: false,
    reason: 'no WU claimed',
    suggestion: 'pnpm wu:claim --id WU-XXXX --lane <Lane>',
  };
}

/**
 * Check if the current working directory is inside a worktree.
 *
 * @param cwd - Current working directory
 * @param projectDir - Project directory
 * @returns True if cwd is inside a worktree
 */
export function isInsideWorktree(cwd: string, projectDir: string): boolean {
  const worktreesDir = path.join(projectDir, resolveWorktreesDirSegment(projectDir));

  if (!fs.existsSync(worktreesDir)) {
    return false;
  }

  const resolvedCwd = path.resolve(cwd);
  return resolvedCwd.startsWith(worktreesDir + path.sep);
}

/**
 * Get list of active worktrees.
 *
 * @param projectDir - Project directory
 * @returns Array of worktree names
 */
export function getActiveWorktrees(projectDir: string): string[] {
  const worktreesDir = path.join(projectDir, resolveWorktreesDirSegment(projectDir));

  if (!fs.existsSync(worktreesDir)) {
    return [];
  }

  try {
    return fs.readdirSync(worktreesDir).filter((e) => {
      const stat = fs.statSync(path.join(worktreesDir, e));
      return stat.isDirectory();
    });
  } catch {
    return [];
  }
}
