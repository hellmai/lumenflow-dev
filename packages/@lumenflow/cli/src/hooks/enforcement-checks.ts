/**
 * @file enforcement-checks.ts
 * Runtime enforcement checks for LumenFlow workflow compliance (WU-1367)
 * WU-1501: Fail-closed default on main - block writes when no active claim context
 *
 * These functions can be used by hooks to validate operations.
 * Graceful degradation: if LumenFlow is NOT configured, operations are allowed.
 * Fail-closed: if LumenFlow IS configured, writes on main require an active
 * claim context (worktree or branch-pr) or an allowlisted path.
 */

// Note: fs operations use runtime-provided paths from LumenFlow configuration

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * WU-1501: Paths that are always safe to write on main checkout.
 * These are scaffold/state paths that are written by lifecycle commands
 * and must not require a worktree.
 */
const MAIN_WRITE_ALLOWLIST_PREFIXES = [
  'docs/04-operations/tasks/wu/',
  '.lumenflow/',
  '.claude/',
  'plan/',
] as const;

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
 * WU-1501: Check if a resolved path matches the main-write allowlist.
 *
 * @param resolvedPath - Absolute resolved path to check
 * @param mainRepoPath - Absolute path to the main repo root
 * @returns True if the path is in the allowlist
 */
function isAllowlistedPath(resolvedPath: string, mainRepoPath: string): boolean {
  // Get the path relative to the repo root
  const repoPrefix = mainRepoPath + path.sep;
  if (!resolvedPath.startsWith(repoPrefix)) {
    return false;
  }
  const relativePath = resolvedPath.slice(repoPrefix.length);

  return MAIN_WRITE_ALLOWLIST_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
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
  const worktreesDir = path.join(mainRepoPath, 'worktrees');

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
      suggestion: 'cd to your worktree: cd worktrees/<lane>-wu-<id>/',
    };
  }

  // WU-1501: No active worktrees - fail-closed on main
  // Check allowlist first (always permitted regardless of claim state)
  if (isAllowlistedPath(resolvedPath, mainRepoPath)) {
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
  const mainRepoPath = projectDir ?? process.env.CLAUDE_PROJECT_DIR;

  if (!mainRepoPath) {
    return {
      allowed: true,
      reason: 'graceful: CLAUDE_PROJECT_DIR not set',
    };
  }

  const lumenflowDir = path.join(mainRepoPath, '.lumenflow');
  const worktreesDir = path.join(mainRepoPath, 'worktrees');
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
  const worktreesDir = path.join(projectDir, 'worktrees');

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
  const worktreesDir = path.join(projectDir, 'worktrees');

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
