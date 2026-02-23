// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file worktree-enforcement.ts
 * @description Worktree enforcement guard for MCP file_write and file_edit tools.
 *
 * WU-1853: MCP tool calls do not trigger Claude Code PreToolUse hooks, so
 * file_write and file_edit can bypass the enforce-worktree.sh hook that blocks
 * direct writes to the main checkout. This module mirrors the shell hook logic
 * in TypeScript so the MCP server can enforce the same policy.
 *
 * Enforcement check mirrors enforce-worktree.sh:
 *   - Allow writes inside worktrees/
 *   - Allow writes to .lumenflow/, .claude/, docs/tasks/wu/, plan/
 *   - Block everything else when on main/master and enforcement is active
 *   - Gracefully allow if config cannot be read
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { getConfig, findProjectRoot } from '@lumenflow/core';

/**
 * Error code returned when a write is blocked by worktree enforcement.
 */
export const WORKTREE_ENFORCEMENT_ERROR_CODE = 'WORKTREE_ENFORCEMENT_BLOCKED';

/**
 * Branches that are considered "main" and subject to enforcement.
 */
const PROTECTED_BRANCHES = ['main', 'master'] as const;

/**
 * Relative path prefixes that are always allowed on main checkout.
 * Mirrors the allowlist in enforce-worktree.sh.
 */
const STATIC_ALLOWLISTED_PATH_PREFIXES = ['.lumenflow/', '.claude/', 'plan/'] as const;

/**
 * Result of a worktree enforcement check.
 */
export interface WorktreeEnforcementResult {
  /** Whether the write operation is allowed */
  allowed: boolean;
  /** Error code when blocked */
  errorCode?: string;
  /** Human-readable reason when blocked */
  reason?: string;
}

export interface WorktreeEnforcementInput {
  /** Path to the file being written (relative or absolute) */
  filePath: string;
  /** Project root override (defaults to auto-detection) */
  projectRoot?: string;
}

/**
 * Check whether a file write/edit should be allowed based on worktree enforcement policy.
 *
 * Mirrors the logic in enforce-worktree.sh but runs in-process for MCP tools.
 *
 * Graceful degradation: if any check fails (config unreadable, git unavailable,
 * .lumenflow not configured), the operation is allowed to prevent blocking
 * legitimate work.
 */
export function checkWorktreeEnforcement(
  input: WorktreeEnforcementInput,
): WorktreeEnforcementResult {
  const { filePath } = input;

  try {
    const projectRoot = input.projectRoot ?? findProjectRoot();

    // Graceful degradation: LumenFlow not configured
    const lumenflowDir = path.join(projectRoot, '.lumenflow');
    if (!existsSync(lumenflowDir)) {
      return { allowed: true };
    }

    // Read enforcement config
    const config = getConfig({ projectRoot });
    const enforcement = config?.agents?.clients?.['claude-code']?.enforcement;
    const worktreesPrefix = normalizePrefix(config.directories.worktrees);
    const allowlistedPrefixes = buildAllowlistedPathPrefixes(config);
    if (!enforcement?.block_outside_worktree) {
      return { allowed: true };
    }

    // Detect current branch
    const currentBranch = detectCurrentBranch(projectRoot);
    if (!currentBranch) {
      // Branch detection failed -- graceful degradation
      return { allowed: true };
    }

    // Allow operations on non-main branches
    if (!isProtectedBranch(currentBranch)) {
      return { allowed: true };
    }

    // Resolve the file path to a relative path within the project
    const resolvedPath = resolveFilePath(filePath, projectRoot);

    // Allow if path is outside the project entirely
    if (resolvedPath === null) {
      return { allowed: true };
    }

    // Allow if path is inside a worktree
    if (resolvedPath.startsWith(worktreesPrefix)) {
      return { allowed: true };
    }

    // Allow if path matches the allowlist
    if (isAllowlistedPath(resolvedPath, allowlistedPrefixes)) {
      return { allowed: true };
    }

    // Block the write
    return {
      allowed: false,
      errorCode: WORKTREE_ENFORCEMENT_ERROR_CODE,
      reason:
        `Write to '${filePath}' blocked: you are on the '${currentBranch}' branch. ` +
        'Direct writes to main checkout are not allowed when worktree enforcement is active. ' +
        'Use pnpm wu:claim to create a worktree and work there instead.',
    };
  } catch {
    // Graceful degradation: any unexpected error allows the operation
    return { allowed: true };
  }
}

/**
 * Detect the current git branch for the given project root.
 * Returns null if detection fails.
 */
function detectCurrentBranch(projectRoot: string): string | null {
  try {
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- git resolved from PATH; workflow tooling requires git
    const result = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Check if a branch name is a protected branch (main/master).
 */
function isProtectedBranch(branchName: string): boolean {
  return (PROTECTED_BRANCHES as readonly string[]).includes(branchName);
}

/**
 * Resolve a file path to a relative path within the project.
 * Returns null if the path is outside the project root.
 */
function resolveFilePath(filePath: string, projectRoot: string): string | null {
  let resolved: string;

  if (path.isAbsolute(filePath)) {
    resolved = filePath;
  } else {
    // Relative path is relative to project root
    resolved = path.resolve(projectRoot, filePath);
  }

  // Normalize both paths for comparison
  const normalizedProject = projectRoot.endsWith('/') ? projectRoot : `${projectRoot}/`;

  // Check if the resolved path is inside the project
  if (!resolved.startsWith(normalizedProject) && resolved !== projectRoot) {
    return null;
  }

  // Return the relative path
  return toPosixPath(path.relative(projectRoot, resolved));
}

/**
 * Check if a relative path matches the allowlist.
 */
function isAllowlistedPath(relativePath: string, allowlistedPrefixes: readonly string[]): boolean {
  return allowlistedPrefixes.some((prefix) => relativePath.startsWith(prefix));
}

function buildAllowlistedPathPrefixes(config: ReturnType<typeof getConfig>): readonly string[] {
  return [normalizePrefix(config.directories.wuDir), ...STATIC_ALLOWLISTED_PATH_PREFIXES];
}

function normalizePrefix(value: string): string {
  const normalized = toPosixPath(value);
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function toPosixPath(value: string): string {
  return value.replaceAll('\\', '/');
}
