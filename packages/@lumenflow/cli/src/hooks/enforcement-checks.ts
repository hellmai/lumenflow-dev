/**
 * @file enforcement-checks.ts
 * Runtime enforcement checks for LumenFlow workflow compliance (WU-1367)
 *
 * These functions can be used by hooks to validate operations.
 * All checks implement graceful degradation: if state cannot be
 * determined, operations are allowed.
 */

// Note: fs operations use runtime-provided paths from LumenFlow configuration

import * as fs from 'node:fs';
import * as path from 'node:path';

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
 * Check if a Write/Edit operation should be allowed based on worktree enforcement.
 *
 * Implements graceful degradation: if LumenFlow state cannot be determined,
 * the operation is allowed to prevent blocking legitimate work.
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

  // No worktrees = no enforcement needed
  if (!fs.existsSync(worktreesDir)) {
    return {
      allowed: true,
      reason: 'no worktrees exist',
    };
  }

  // Check for active worktrees
  let worktreeCount = 0;
  try {
    const entries = fs.readdirSync(worktreesDir);
    worktreeCount = entries.filter((e) => {
      const stat = fs.statSync(path.join(worktreesDir, e));
      return stat.isDirectory();
    }).length;
  } catch {
    return {
      allowed: true,
      reason: 'graceful: cannot read worktrees directory',
    };
  }

  if (worktreeCount === 0) {
    return {
      allowed: true,
      reason: 'no active worktrees',
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

  // Allow if path is inside a worktree
  if (resolvedPath.startsWith(worktreesDir + path.sep)) {
    return {
      allowed: true,
      reason: 'path is inside worktree',
    };
  }

  // Block if path is in main repo while worktrees exist
  if (resolvedPath.startsWith(mainRepoPath + path.sep) || resolvedPath === mainRepoPath) {
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

  // Path is outside repo entirely - allow
  return {
    allowed: true,
    reason: 'path is outside repository',
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
